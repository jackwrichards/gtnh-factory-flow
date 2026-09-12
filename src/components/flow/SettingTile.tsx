"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { focusDropdownFilter } from "@/lib/dropdown-focus";
import { useDropdownViewport } from "@/lib/hooks/use-dropdown-viewport";

import { ChevronDown, Minus, Plus, Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import type { MachineConfigTierControl } from "@/lib/model/recipe-rules";
import type { MachineConfigTierOption, ResourceAmount } from "@/lib/model/types";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { ResourceIcon } from "@/components/nei/ResourceIcon";

/**
 * ONE TILE GRAMMAR for a card's machine settings (docs/config-tiles-prd.md).
 *
 * A setting is a captioned tile with a value and one gesture. A SHORT
 * ladder (six rungs or fewer: pressure, a casing mark, on/off) is stepped
 * with minus and plus and the wheel. A LONG ladder (fourteen coils, a dozen
 * fuels) is a dropdown: the well is the button, and the list it opens has
 * a search box, because those rungs are picked by name, not walked. A
 * count also types on click. A face - the rung's own item, bare - sits in
 * the well only when EVERY rung of the ladder has one; otherwise the value
 * text carries the whole meaning. No letters stand in for missing art.
 *
 * The chrome is the crop card's SEEDS tile exactly, so every card's settings
 * read as one family.
 */

export const SETTING_TILE_CLASS =
  "nowheel min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 pb-0.5 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]";
export const SETTING_TILE_CAPTION_CLASS =
  "flex items-center gap-1 truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]";
export const SETTING_TILE_BUTTON_CLASS =
  "flex h-5 w-3.5 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] enabled:hover:bg-[var(--mc-100)] enabled:active:shadow-[inset_1px_1px_0_var(--mc-47),inset_-1px_-1px_0_var(--mc-100)] disabled:opacity-35";
// The value in the well is set like the footer's REASON word (13px bold), so
// "8x" on a parallel tile and "FULL" in the footer read as the same ink.
const SETTING_TILE_WELL_CLASS =
  "flex h-5 w-0 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden whitespace-nowrap border border-[var(--mc-47)] bg-[var(--mc-85)] px-0.5 text-center text-[13px] font-bold leading-[18px] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)]";

/** One tile is a caption line over a 20px control row: two grid cells. */
export const SETTING_TILE_HEIGHT_PX = 40;
/**
 * The narrowest a tile is allowed: two 14px steppers, a well with room for a
 * short value, and the frame. Captions and values truncate past it, so a
 * panel packs as many tiles across as this lets it (RecipeNode's config grid).
 */
export const SETTING_TILE_MIN_WIDTH_PX = 96;
/** The gap between tiles in that grid (Tailwind gap-1). */
export const SETTING_TILE_GAP_PX = 4;
/** Past this many rungs a ladder is picked from a searchable list, not stepped. */
export const STEPPER_MAX_RUNGS = 6;

/**
 * The caption: the setting's short name in the game's own word. The
 * dataset's labels carry the noun's family ("Heating Coil", "Pipe Casing");
 * the tile keeps the word a player says.
 */
const CAPTIONS: Record<string, string> = {
  heatingCoil: "Coil",
  pipeCasing: "Casing",
  solenoidCoil: "Solenoid",
  arcElectrode: "Electrode",
  preciseCasing: "Unit casing",
  cuttingSawblade: "Sawblade",
  fluxElectromagnet: "Magnet",
  laserSource: "Laser source",
  "structure-tower-height": "Height",
  steamPressure: "Pressure",
};

export function settingCaption(control: Pick<MachineConfigTierControl, "id" | "label">): string {
  return CAPTIONS[control.id] ?? control.label;
}

/**
 * The value: the rung's own name and nothing more. "Kanthal", not "Kanthal
 * Coil Block"; "High", not "High Pressure"; "256A", not "256A Laser".
 */
const VALUE_TRIMS: Array<[RegExp, string]> = [
  [/\s+Coil Block$/i, ""],
  [/\s+Pipe Casing$/i, ""],
  [/\s+Solenoid Superconductor Coil$/i, ""],
  [/\s+Laser$/i, ""],
  [/\s+Pressure$/i, ""],
  [/^Tower Height\s+/i, ""],
  [/\s+Parallels?( per Voltage Tier)?$/i, ""],
  [/\s+Field Restriction Coil$/i, ""],
];

export function settingValueLabel(option: Pick<MachineConfigTierOption, "label">): string {
  let label = option.label;
  for (const [pattern, replacement] of VALUE_TRIMS) {
    label = label.replace(pattern, replacement);
  }
  return label.trim() || option.label;
}

function hasArt(resource: ResourceAmount | undefined): boolean {
  return Boolean(resource && (resource.iconPath || resource.iconAtlas));
}

/** The face rule: a well only when every rung has an item to show. */
export function controlHasFaces(control: MachineConfigTierControl): boolean {
  return control.tiers.length > 0 && control.tiers.every((tier) => hasArt(tier.resource ?? control.resource));
}

function Face({ resource }: { resource: ResourceAmount }) {
  return (
    // Same whole-item fit as a port chip. No `alternatives`: the blue plus that marks an
    // oredict slot means nothing on a coil (Jack, 2026-09-06).
    <span className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden">
      <ResourceIcon

        itemZoom={1.5}
        resource={{ ...resource, amount: 1, chance: undefined, alternatives: undefined }}
        bare
        tooltip={false}
        showAmount={false}
        showConsumedState={false}
        className="!h-[18px] !w-[18px]"
      />
    </span>
  );
}

// No native `title` anywhere on a tile (Jack, 2026-09-07): the global title
// tooltip turns a titled element inside a rich area into a STOP, so hovering
// the value well swapped the setting's whole story for the bare number. One
// setting, one hover, everywhere on the tile - the rich panel already names
// the current value in its subtitle.
export function SettingTile({
  caption,
  value,
  face,
  canStepDown,
  canStepUp,
  onStep,
  onList,
  onType,
  disabled = false,
  help,
  captionMark,
}: {
  caption: string;
  value: string;
  /** The current rung's item, only when the whole ladder has faces. */
  face?: ResourceAmount;
  canStepDown: boolean;
  canStepUp: boolean;
  onStep: (direction: -1 | 1) => void;
  /** Right click or held press: open the full list. Ladders only. */
  onList?: (anchor: DOMRect) => void;
  /** Click on the value types a number. Counts only. */
  onType?: () => void;
  disabled?: boolean;
  /** The hover: the shared panel's rows for this setting. */
  help?: ReactNode | (() => ReactNode);
  /** A small mark before the caption (the crop pips). */
  captionMark?: ReactNode;
}) {
  const wellRef = useRef<HTMLSpanElement>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const openList = () => {
    const rect = wellRef.current?.getBoundingClientRect();
    if (rect && onList) onList(rect);
  };
  const tile = (
    <div
      className={[SETTING_TILE_CLASS, disabled ? "opacity-35" : ""].join(" ")}
      onWheel={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onStep(event.deltaY < 0 ? 1 : -1);
      }}
      onContextMenu={(event) => {
        if (!onList || disabled) return;
        event.preventDefault();
        event.stopPropagation();
        openList();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!onList || disabled || event.pointerType === "mouse") return;
        pressTimer.current = window.setTimeout(openList, 450);
      }}
      onPointerUp={() => window.clearTimeout(pressTimer.current)}
      onPointerCancel={() => window.clearTimeout(pressTimer.current)}
    >
      <div className={SETTING_TILE_CAPTION_CLASS}>
        {captionMark}
        <span className="min-w-0 truncate">{caption}</span>
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          className={SETTING_TILE_BUTTON_CLASS}
          disabled={disabled || !canStepDown}
          onClick={(event) => {
            event.stopPropagation();
            onStep(-1);
          }}
          aria-label={`Previous ${caption}`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span
          ref={wellRef}
          className={[SETTING_TILE_WELL_CLASS, onType && !disabled ? "cursor-text" : ""].join(" ")}
          onClick={
            onType && !disabled
              ? (event) => {
                  event.stopPropagation();
                  onType();
                }
              : undefined
          }
          role={onType ? "button" : undefined}
          tabIndex={onType && !disabled ? 0 : undefined}
          aria-label={onType ? `Edit ${caption}` : undefined}
          onKeyDown={onType ? (event) => {
            if (!disabled && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              event.stopPropagation();
              onType();
            }
          } : undefined}
        >
          {face ? <Face resource={face} /> : null}
          <span className="min-w-0 truncate">{value}</span>
        </span>
        <button
          type="button"
          className={SETTING_TILE_BUTTON_CLASS}
          disabled={disabled || !canStepUp}
          onClick={(event) => {
            event.stopPropagation();
            onStep(1);
          }}
          aria-label={`Next ${caption}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
  return help ? <MinecraftTooltip content={help}>{tile}</MinecraftTooltip> : tile;
}

/**
 * The full list behind a ladder, for the long jump a fourteen-rung coil
 * needs: a fixed panel under the tile's well, one row per rung with its
 * face and name, the current rung marked. Escape, a click outside or a
 * pick closes it.
 */
export function SettingListMenu({
  anchor,
  rows,
  currentKey,
  onPick,
  onClose,
  searchable = false,
}: {
  anchor: DOMRect;
  rows: Array<{ key: string; label: string; face?: ResourceAmount; hint?: string }>;
  currentKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
  /** A filter box at the top, for lists picked by name. */
  searchable?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const viewport = useDropdownViewport();
  // Numbered hatch choices should match with or without thousands separators.
  const needle = query.trim().toLowerCase().replaceAll(",", "");
  const shown = needle ? rows.filter((row) => row.label.toLowerCase().replaceAll(",", "").includes(needle)) : rows;
  useDropdownDismiss(true, { refs: [rootRef], onClose, fade: true });
  if (typeof document === "undefined") return null;
  // The anchor rect and the window are real px; this box is zoomed (ui-zoom),
  // so its fixed offsets are shell px: real px are divided by the scale.
  const scale = getUiScale();
  const shell = (px: number) => px / scale;
  const width = Math.min(240, Math.max(0, shell(viewport.width) - 16));
  const left = Math.max(shell(viewport.left) + 8, Math.min(shell(anchor.left + anchor.width / 2) - width / 2, shell(viewport.left + viewport.width) - width - 8));
  const maxHeight = Math.min(360, Math.max(0, shell(viewport.height) - 16));
  const height = Math.min(maxHeight, Math.max(1, shown.length) * 28 + 12 + (searchable ? 36 : 0));
  const below = shell(anchor.bottom) + 4;
  const bottom = shell(viewport.top + viewport.height) - 8;
  const fitsBelow = bottom - below >= height;
  const top = Math.max(shell(viewport.top) + 8, Math.min(fitsBelow ? below : shell(anchor.top) - height - 4, bottom - height));
  return createPortal(
    <div
      ref={rootRef}
      role="listbox"
      className="ui-zoom nodrag nowheel fixed z-[300] flex max-h-[360px] flex-col border-2 border-[var(--mc-15)] bg-[var(--mc-49)] py-1 shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),2px_3px_6px_rgba(0,0,0,0.2)]"
      style={{ left, width, top, maxHeight }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {searchable ? (
        <label className="mx-1 mb-1 flex h-7 shrink-0 items-center gap-1.5 border border-[var(--mc-33)] bg-[var(--mc-85)] px-1.5 text-[12px] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--mc-ink-muted)]" />
          <input
            ref={focusDropdownFilter}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && shown[0]) {
                event.preventDefault();
                onPick(shown[0].key);
              }
            }}
            placeholder="Filter..."
            aria-label="Filter options"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--mc-ink-muted)]"
          />
        </label>
      ) : null}
      <div className="min-h-0 overflow-y-auto">
      {shown.length === 0 ? (
        <div className="px-2 py-1.5 text-[12px] text-[var(--mc-ink-muted)]">No match.</div>
      ) : null}
      {shown.map((row) => (
        <button
          key={row.key}
          type="button"
          role="option"
          aria-selected={row.key === currentKey}
          onClick={(event) => {
            event.stopPropagation();
            onPick(row.key);
          }}
          className={[
            "flex h-7 w-full items-center gap-2 px-2 text-left text-[12px] leading-4",
            row.key === currentKey ? "bg-[var(--mc-71)] text-white" : "text-[var(--mc-ink)] hover:bg-[var(--mc-61)] hover:text-white",
          ].join(" ")}
        >
          {row.face ? <Face resource={row.face} /> : null}
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.hint ? <span className="shrink-0 text-[10px] text-[var(--mc-ink-muted)]">{row.hint}</span> : null}
        </button>
      ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The dropdown tile for a long ladder: the same caption and well, but the
 * well is one button wearing the current rung's face and name with a
 * chevron, and a click opens the searchable list. The wheel still steps.
 */
export function SettingSelectTile({
  caption,
  rows,
  currentKey,
  onPick,
  disabled = false,
  help,
}: {
  caption: string;
  rows: Array<{ key: string; label: string; face?: ResourceAmount; hint?: string }>;
  currentKey: string;
  onPick: (key: string) => void;
  disabled?: boolean;
  help?: ReactNode | (() => ReactNode);
}) {
  const [listAt, setListAt] = useState<DOMRect | undefined>();
  const wellRef = useRef<HTMLButtonElement>(null);
  const index = Math.max(0, rows.findIndex((row) => row.key === currentKey));
  const current = rows[index];
  const tile = (
    <div
      className={[SETTING_TILE_CLASS, disabled ? "opacity-35" : ""].join(" ")}
      onWheel={(event) => {
        event.stopPropagation();
        if (disabled) return;
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.deltaY < 0 ? 1 : -1)))];
        if (next && next.key !== currentKey) onPick(next.key);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={SETTING_TILE_CAPTION_CLASS}>
        <span className="min-w-0 truncate">{caption}</span>
      </div>
      <button
        ref={wellRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={listAt !== undefined}
        aria-label={caption}
        onClick={(event) => {
          event.stopPropagation();
          const rect = wellRef.current?.getBoundingClientRect();
          if (rect) setListAt(listAt ? undefined : rect);
        }}
        className={[SETTING_TILE_WELL_CLASS, "w-full flex-none justify-between px-1 enabled:hover:bg-[var(--mc-93)]"].join(" ")}
      >
        <span className="flex min-w-0 items-center gap-1">
          {current?.face ? <Face resource={current.face} /> : null}
          <span className="min-w-0 truncate">{current?.label ?? currentKey}</span>
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-[var(--mc-ink-muted)]" />
      </button>
      {listAt ? (
        <SettingListMenu
          anchor={listAt}
          rows={rows}
          currentKey={currentKey}
          searchable
          onPick={(key) => {
            setListAt(undefined);
            onPick(key);
          }}
          onClose={() => setListAt(undefined)}
        />
      ) : null}
    </div>
  );
  return help ? <MinecraftTooltip content={help}>{tile}</MinecraftTooltip> : tile;
}

/**
 * A FACT in the settings grid: a caption over a recessed value with no
 * controls - the parallel count a casing gives, a generator's efficiency.
 * Facts sit after the settings in the same grid so a card with one setting
 * and one fact fills one row instead of two bands.
 */
export function FactTile({
  caption,
  value,
  help,
}: {
  caption: string;
  value: string;
  help?: ReactNode | (() => ReactNode);
}) {
  const tile = (
    <div className={SETTING_TILE_CLASS}>
      <div className={SETTING_TILE_CAPTION_CLASS}>
        <span className="min-w-0 truncate">{caption}</span>
      </div>
      <div className="flex min-w-0 items-center">
        <span className={[SETTING_TILE_WELL_CLASS, "w-full flex-none px-1 tabular-nums"].join(" ")}>
          <span className="min-w-0 truncate">{value}</span>
        </span>
      </div>
    </div>
  );
  return help ? <MinecraftTooltip content={help}>{tile}</MinecraftTooltip> : tile;
}

/** A tile over a ladder of tier options: the shape most machine settings take. */
export function LadderTile({
  control,
  onSelect,
  help,
}: {
  control: MachineConfigTierControl;
  onSelect: (key: string) => void;
  help?: ReactNode | (() => ReactNode);
}) {
  const [listAt, setListAt] = useState<DOMRect | undefined>();
  const index = Math.max(0, control.tiers.findIndex((tier) => tier.key === control.current.key));
  const faces = controlHasFaces(control);
  if (control.numeric) {
    return <MachineNumberTile control={control} onSelect={onSelect} help={help} />;
  }
  if (control.tiers.length > STEPPER_MAX_RUNGS) {
    return (
      <SettingSelectTile
        caption={settingCaption(control)}
        rows={control.tiers.map((tier) => ({
          key: tier.key,
          label: settingValueLabel(tier),
          face: faces ? (tier.resource ?? control.resource) : undefined,
        }))}
        currentKey={control.current.key}
        onPick={onSelect}
        help={help}
      />
    );
  }
  const step = (direction: -1 | 1) => {
    const next = control.tiers[Math.max(0, Math.min(control.tiers.length - 1, index + direction))];
    if (next && next.key !== control.current.key) onSelect(next.key);
  };
  return (
    <>
      <SettingTile
        caption={settingCaption(control)}
        value={settingValueLabel(control.current)}
        face={faces ? (control.current.resource ?? control.resource) : undefined}
        canStepDown={index > 0}
        canStepUp={index < control.tiers.length - 1}
        onStep={step}
        onList={control.tiers.length > 2 ? setListAt : undefined}
        disabled={control.tiers.length <= 1}
        help={help}
      />
      {listAt ? (
        <SettingListMenu
          anchor={listAt}
          rows={control.tiers.map((tier) => ({
            key: tier.key,
            label: settingValueLabel(tier),
            face: faces ? (tier.resource ?? control.resource) : undefined,
          }))}
          currentKey={control.current.key}
          onPick={(key) => {
            setListAt(undefined);
            onSelect(key);
          }}
          onClose={() => setListAt(undefined)}
        />
      ) : null}
    </>
  );
}

/** Numeric machine settings keep their value in the existing config map.
 * Drafts stay local: Enter/blur is one undoable edit, Escape cancels it.
 */
function MachineNumberTile({ control, onSelect, help }: {
  control: MachineConfigTierControl;
  onSelect: (key: string) => void;
  help?: ReactNode | (() => ReactNode);
}) {
  const [draft, setDraft] = useState<string>();
  const finished = useRef(false);
  const shown = Number(control.current.key);
  const { min, max = Number.MAX_SAFE_INTEGER } = control.numeric!;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.trunc(n)));
  const pick = (n: number) => {
    const key = String(clamp(n));
    if (key !== control.current.key) onSelect(key);
  };
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    const text = draft?.replaceAll(",", "").trim() ?? "";
    const parsed = Number(text);
    if (text && Number.isSafeInteger(parsed)) pick(parsed);
    setDraft(undefined);
  };
  const caption = settingCaption(control);
  if (draft !== undefined) {
    return <div className={`${SETTING_TILE_CLASS} nodrag`} onPointerDown={(event) => event.stopPropagation()}>
      <div className={SETTING_TILE_CAPTION_CLASS}>{caption}</div>
      <input autoFocus inputMode="numeric" aria-label={control.label} value={draft}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") {
            event.preventDefault(); finished.current = true; setDraft(undefined);
          }
        }}
        className="h-5 w-full min-w-0 border border-[var(--mc-47)] bg-[var(--mc-93)] px-1 text-center text-[13px] font-bold leading-[18px] text-[var(--mc-ink)] outline-none"
      />
    </div>;
  }
  return <SettingTile caption={caption} value={shown.toLocaleString("en-US")}
    canStepDown={shown > min} canStepUp={shown < max}
    onStep={(direction) => pick(shown + direction)}
    onType={() => { finished.current = false; setDraft(String(shown)); }} help={help} />;
}
