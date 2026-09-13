"use client";

import { useState } from "react";
import type { MachineConfigTierControl } from "@/lib/model/recipe-rules";
import { settingCaption } from "../flow/SettingTile";
import { ResourceIcon } from "../nei/ResourceIcon";

/** Inline steppers keep ordinary machine settings visible without opening a panel. */
export function WorksheetSetting({
  control,
  onSelect,
}: {
  control: MachineConfigTierControl;
  onSelect: (id: string, value: string) => void;
}) {
  const { id, current, tiers, minimumIndex, numeric } = control;
  const index = tiers.findIndex((tier) => tier.key === current.key);
  return (
    <span className="pool-inline-setting">
      <span>{settingCaption(control)}</span>
      {current.resource ? (
        <ResourceIcon
          resource={{ ...current.resource, amount: 1 }}
          bare
          size="sm"
          className="!h-4 !w-4"
          iconPixelSize={16}
          showAmount={false}
          tooltip={false}
        />
      ) : null}
      <button
        type="button"
        aria-label={`Decrease ${control.label}`}
        disabled={numeric ? Number(current.key) <= numeric.min : index <= minimumIndex}
        onClick={() =>
          onSelect(
            id,
            numeric ? String(Math.max(numeric.min, Number(current.key) - 1)) : tiers[index - 1].key,
          )
        }
      >
        −
      </button>
      {numeric ? (
        <WorksheetNumber
          key={current.key}
          value={Number(current.key)}
          min={numeric.min}
          max={numeric.max}
          label={control.label}
          onCommit={(value) => {
            if (value !== undefined) onSelect(id, String(Math.floor(value)));
          }}
        />
      ) : (
        <span className="pool-setting-value" title={current.label}>
          {current.label}
        </span>
      )}
      <button
        type="button"
        aria-label={`Increase ${control.label}`}
        disabled={
          numeric
            ? numeric.max !== undefined && Number(current.key) >= numeric.max
            : index >= tiers.length - 1
        }
        onClick={() =>
          onSelect(
            id,
            numeric
              ? String(Math.min(numeric.max ?? Infinity, Number(current.key) + 1))
              : tiers[index + 1].key,
          )
        }
      >
        +
      </button>
    </span>
  );
}

export function WorksheetNumber({
  value,
  min = 0,
  max = Infinity,
  label,
  placeholder,
  onCommit,
}: {
  value?: number;
  min?: number;
  max?: number;
  label: string;
  placeholder?: string;
  onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim()) {
      onCommit(undefined);
      return;
    }
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
    else setDraft(value === undefined ? "" : String(value));
  };
  return (
    <input
      aria-label={label}
      className="pool-number-input"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value === undefined ? "" : String(value));
          event.stopPropagation();
        }
      }}
    />
  );
}
