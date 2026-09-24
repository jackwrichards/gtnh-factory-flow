"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import type { StorageRole } from "@/lib/model/storage-role";
import { isInputRate, storageTargetMode, type TargetMode } from "@/lib/model/storage-target";
import { formatCompact, formatPowerValue, trimTrailingDecimalZeros } from "@/lib/model";
import { rateMultiplierForKind, rateSuffixForKind } from "@/lib/model/rate-unit";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { playBoardSound, suppressBoardSound } from "@/lib/board-sounds";
import { hasAnySolveNumbers } from "@/lib/solver/throughput";
import { useFactoryStore } from "@/store/factory-store";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { RecipeTooltip } from "./RecipeTooltip";
import { buildRatePlateTooltip } from "./storage-tooltip-data";

/**
 * A rate rule and your rate, the way a source or product drawer sets them in
 * Solve (Jack, 2026-09-22): a rule BUTTON with a ▾ that opens the four rules
 * in words, and your rate in a sunken BOX you click and type into. Pool's
 * Desired rates borrow the rule button (`useTableRule`), with the word
 * spelled out beside its mark; their Target column keeps its own editor.
 * The resources panel's drawer rows wear the same dress, mark alone.
 */

/** The rule list, in the order the rule button's wheel steps through it. Any
 * is stored as "ignore": a number can wait there without applying. */
export const RULE_STEPS: TargetMode[] = ["ignore", "at-least", "exact", "at-most"];
export const RULE_MARK: Record<TargetMode, string> = { ignore: "~", "at-least": "≥", exact: "=", "at-most": "≤" };
export const RULE_NAME: Record<TargetMode, string> = { ignore: "Any", "at-least": "At least", exact: "Exactly", "at-most": "At most" };

/** "mark" is the table's dress without the word, for the resources panel's
 * rows, where a word would crowd the name out of its line. */
export type RateRuleVariant = "drawer" | "table" | "mark";

/**
 * "2.5k" is a number: metric shorthand for the rate field, k / m / g for
 * thousand, million, billion, either case, spaces and commas forgiven.
 * Anything else is not a number and the caller falls back rather than guess.
 */
export function parseAmountWithSuffix(text: string): number | undefined {
  const match = text
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/^−/, "-")
    .match(/^([+-]?[0-9]*\.?[0-9]+)\s*([kmg]?)$/);
  if (!match) {
    return undefined;
  }
  const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : match[2] === "g" ? 1e9 : 1;
  return Number.parseFloat(match[1]!) * multiplier;
}

/** The mirror: a committed value is SHOWN in the same shorthand it was
 * typed in - 10000 reads back as 10k, never expanded under your cursor. */
export function formatAmountWithSuffix(value: number): string {
  if (value < 0) return "-" + formatAmountWithSuffix(-value);
  if (value >= 1e9) {
    return `${trimTrailingDecimalZeros((value / 1e9).toFixed(2))}g`;
  }
  if (value >= 1e6) {
    return `${trimTrailingDecimalZeros((value / 1e6).toFixed(2))}m`;
  }
  if (value >= 1e3) {
    return `${trimTrailingDecimalZeros((value / 1e3).toFixed(2))}k`;
  }
  return trimTrailingDecimalZeros(value.toFixed(4));
}

export function trimFlow(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimTrailingDecimalZeros(value.toFixed(decimals));
}

/** A field value in the board's rate unit and the typed shorthand. */
function draftFor(perSecond: number, kind: string): string {
  const shown = Math.abs(perSecond * rateMultiplierForKind(kind));
  return shown < 1
    ? shown.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 6 })
    : formatAmountWithSuffix(shown);
}

/** Your number in the field: the drawer's compact form, without the unit. */
function formatFieldNumber(perSecond: number, kind: string): string {
  const scaled = Math.abs(perSecond * rateMultiplierForKind(kind));
  if (kind === "power") return formatPowerValue(scaled);
  if (scaled >= 1_000_000) return `${trimFlow(scaled / 1_000_000)}M`;
  if (scaled >= 1_000) return `${trimFlow(scaled / 1_000)}k`;
  return scaled >= 1 ? trimFlow(scaled) : formatCompact(scaled);
}

type ClickLike = { button: number; preventDefault: () => void; stopPropagation: () => void };

/**
 * One drawer's rule and rate, and every way to change them. `flowing` is the
 * real rate's size, which a rule picked on an Any drawer starts from. In Pool
 * rates are SIGNED as typed (a minus makes an input); on the board the
 * drawer's own direction decides and the box shows sizes.
 */
export function useRateRule({
  storage,
  role,
  result,
  flowing,
}: {
  storage: FactoryStorage;
  role: StorageRole | undefined;
  result: StorageThroughputResult | undefined;
  flowing: number;
}) {
  const setStorageTarget = useFactoryStore((state) => state.setStorageTarget);
  const setStorageTargetMode = useFactoryStore((state) => state.setStorageTargetMode);
  const setStorageRule = useFactoryStore((state) => state.setStorageRule);
  const locked = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const signed = useFactoryStore((state) => state.project.poolMode === true);
  const mode = storageTargetMode(storage, role);
  const target = storage.targetPerSecond;
  const any = target === undefined || mode === "ignore";
  const input = isInputRate(storage, role);
  // While the solver has NOTHING to solve for - no amount, no pin, anywhere -
  // every empty box pulses the ask, in step with the board's notice.
  const ask = useFactoryStore((state) => target === undefined && mode !== "ignore" && !hasAnySolveNumbers(state.project));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // A rule picked on an empty drawer with nothing flowing yet waits here for
  // the number the box is about to ask for.
  const [pendingMode, setPendingMode] = useState<TargetMode | undefined>(undefined);
  const kind = storage.kind;
  const shownMode: TargetMode = any ? "ignore" : mode;
  // A stored value in the direction it is shown: signed in Pool, a size on
  // the board, where the store puts a source's minus back itself.
  const direction = signed && input ? -1 : 1;
  const place = (size: number) => (size === 0 ? 0 : direction * size);

  const beginEdit = (perSecond: number | undefined, nextMode?: TargetMode) => {
    if (locked) return;
    setOpen(false);
    setPendingMode(nextMode);
    setDraft(perSecond === undefined ? "" : `${signed && input && perSecond !== 0 ? "-" : ""}${draftFor(perSecond, kind)}`);
    setEditing(true);
  };
  const cancelEdit = () => {
    setPendingMode(undefined);
    setEditing(false);
  };
  // Picking a rule. From Any with no number yet, the rule starts from what
  // flows now; with nothing flowing, the box asks for the number.
  const choose = (next: TargetMode) => {
    const state = useFactoryStore.getState();
    setOpen(false);
    if (state.isReadOnly || state.checklistMode || next === shownMode) return;
    if (next === "ignore") {
      if (target !== undefined) setStorageTargetMode(storage.id, "ignore");
      return;
    }
    if (target === undefined) {
      const pinned = Number(Math.abs(flowing).toPrecision(4));
      if (pinned > 0) setStorageRule(storage.id, next, place(pinned));
      else beginEdit(undefined, next);
      return;
    }
    setStorageTargetMode(storage.id, next);
  };
  const stepRule = (by: 1 | -1) => {
    const index = RULE_STEPS.indexOf(shownMode);
    choose(RULE_STEPS[Math.min(RULE_STEPS.length - 1, Math.max(0, index + by))]!);
  };

  // Scrolling the box walks your rate, like the machine count: by 1 in the
  // board's rate unit, Ctrl (or Cmd) by 10, Shift by 100, landing on whole
  // steps. From Any it starts at what flows now, under the role's default
  // rule. Never below zero, and never across it: the sign stays the row's.
  const stepRate = (up: boolean, modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const state = useFactoryStore.getState();
    if (state.isReadOnly || state.checklistMode) return;
    const step = modifiers.shiftKey ? 100 : modifiers.ctrlKey || modifiers.metaKey ? 10 : 1;
    const unitScale = rateMultiplierForKind(kind);
    const shown = (any ? Math.abs(flowing) : Math.abs(target!)) * unitScale;
    const next = Math.max(0, up ? Math.floor(shown / step + 1e-9) * step + step : Math.ceil(shown / step - 1e-9) * step - step);
    if (!any && Math.abs(next - shown) < 1e-9) return;
    // Scrolling down on an empty box asks for nothing: no zero rule appears.
    if (any && next === 0) return;
    const perSecond = place(next / unitScale);
    // The tick and the hush go FIRST: the write below is a project change,
    // and the board's sound watcher answers it with its own adjust tap the
    // moment it lands - one step, two sounds, if the hush comes after.
    playBoardSound("dialRate", { step: Math.min(6, Math.log10(Math.max(1, next)) * 2) });
    suppressBoardSound("adjust", 150);
    if (any) setStorageRule(storage.id, input ? "exact" : "at-least", perSecond);
    else setStorageTarget(storage.id, perSecond);
  };

  const commit = () => {
    setEditing(false);
    const wasPending = pendingMode !== undefined;
    setPendingMode(undefined);
    const text = draft.trim();
    if (text === "") {
      if (target !== undefined) setStorageTarget(storage.id, undefined);
      return;
    }
    const value = parseAmountWithSuffix(text);
    // Not a number: the box keeps what it held. The board shows sizes and the
    // direction is the drawer's; Pool takes the sign as typed, so a minus
    // makes an input and brings the input's default rule.
    if (value === undefined || !Number.isFinite(value) || (!signed && value < 0)) return;
    const typedInput = signed && value !== 0 ? value < 0 : input;
    const rule = pendingMode ?? (any ? (typedInput ? "exact" : "at-least") : mode);
    // Nor a number this rule cannot mean.
    if (value === 0 && rule !== "exact" && rule !== "at-most") return;
    const perSecond = value / rateMultiplierForKind(kind);
    if (any || wasPending) setStorageRule(storage.id, rule, perSecond);
    else setStorageTarget(storage.id, perSecond);
  };
  // Middle click clears the rate from the rule button or the box.
  const clear = (event: ClickLike) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    setEditing(false);
    setPendingMode(undefined);
    if (target !== undefined) setStorageTarget(storage.id, undefined);
  };

  return {
    storage, result, flowing, kind, mode, target, any, input, signed, ask, locked, shownMode,
    open, setOpen, editing, draft, setDraft, beginEdit, cancelEdit, choose, stepRule, stepRate, commit, clear,
  };
}

export type RateRule = ReturnType<typeof useRateRule>;

/** What the rule button needs: the rule shown, the list, and its moves. */
export type RuleControl = Pick<RateRule, "shownMode" | "any" | "locked" | "open" | "setOpen" | "choose" | "stepRule" | "clear"> & {
  /** Named in the button's label where several rows sit together. */
  name?: string;
};

/**
 * Pool's Desired rates rule (Jack, 2026-09-22): the drawer's button and list
 * with its marks, but Pool's own behaviour - picking a rule only switches the
 * rule, the rate stays where the Target column put it, and Any is the old
 * Ignore. The table shows the rule as stored even with no rate typed yet.
 */
export function useTableRule({ storage, role, name }: { storage: FactoryStorage; role: StorageRole | undefined; name: string }): RuleControl {
  const setStorageTarget = useFactoryStore((state) => state.setStorageTarget);
  const setStorageTargetMode = useFactoryStore((state) => state.setStorageTargetMode);
  const locked = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const [open, setOpen] = useState(false);
  const mode = storageTargetMode(storage, role);
  const choose = (next: TargetMode) => {
    const state = useFactoryStore.getState();
    setOpen(false);
    if (state.isReadOnly || state.checklistMode || next === mode) return;
    setStorageTargetMode(storage.id, next);
  };
  const stepRule = (by: 1 | -1) => {
    const index = RULE_STEPS.indexOf(mode);
    choose(RULE_STEPS[Math.min(RULE_STEPS.length - 1, Math.max(0, index + by))]!);
  };
  const clear = (event: ClickLike) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (!locked && storage.targetPerSecond !== undefined) setStorageTarget(storage.id, undefined);
  };
  return { name, shownMode: mode, any: mode === "ignore", locked, open, setOpen, choose, stepRule, clear };
}

/** A native, non-passive wheel listener: React's are passive and cannot stop
 * the board zooming or the worksheet scrolling underneath. */
function useNativeWheel(element: HTMLElement | null, onWheel: (event: WheelEvent) => void) {
  const handler = useRef(onWheel);
  handler.current = onWheel;
  useEffect(() => {
    if (!element) return;
    const listener = (event: WheelEvent) => handler.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, [element]);
}

const middleDownKeepsFocus = (event: { button: number; preventDefault: () => void }) => {
  if (event.button === 1) event.preventDefault();
};

/** The box a list hanging from `element` is cut off by: its nearest
 * scrolling or clipping ancestor, else the window. Real pixels. */
function clippingBox(element: HTMLElement): { top: number; bottom: number } {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow !== "visible") {
      const box = parent.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

/** The rule button and, while open, its list of four. */
export function RuleButton({ rule, variant = "drawer" }: { rule: RuleControl; variant?: RateRuleVariant }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  // A list in a scrolling table opens UPWARD when the room below would cut
  // it off and there is more above: the last row of a list sits on its floor.
  // The drawer's list opens past the card's edge and always hangs down.
  const [up, setUp] = useState(false);
  const { open, setOpen, shownMode, any, locked } = rule;
  useDropdownDismiss(open, { refs: [rootRef], onClose: () => setOpen(false), fade: true });
  useLayoutEffect(() => {
    const anchor = rootRef.current;
    const list = listRef.current;
    if (!open || variant === "drawer" || !anchor || !list) return;
    const clip = clippingBox(anchor);
    const box = anchor.getBoundingClientRect();
    const below = clip.bottom - box.bottom;
    const above = box.top - clip.top;
    setUp(below < list.getBoundingClientRect().height + 4 && above > below);
  }, [open, variant]);
  // Scrolling steps through the rules, clamped. The button is nowheel, so the
  // board camera leaves it to this.
  useNativeWheel(button, (event) => {
    if (event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    rule.stepRule(event.deltaY > 0 ? 1 : -1);
  });
  const table = variant !== "drawer";
  return (
    <span ref={rootRef} className={`storage-rule-anchor ${table ? "storage-rule-anchor--table" : ""}`}>
      <button
        ref={setButton}
        type="button"
        // No tooltip over the rule button at all: the ▾ explains it, and a
        // tip that is already up when the list opens would sit on the list.
        data-tooltip-stop
        className={[
          "storage-rule-button nowheel",
          table ? "storage-rule-button--table" : "",
          variant === "mark" ? "storage-rule-button--mark" : "",
          any ? "storage-rule-button--any" : "",
          open ? "storage-rule-button--open" : "",
        ].join(" ")}
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${rule.name ? `Rule for ${rule.name}` : "Rule"}: ${RULE_NAME[shownMode]}. Click to choose.`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onMouseDown={middleDownKeepsFocus}
        onAuxClick={rule.clear}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            rule.stepRule(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <b className="storage-rule-mark">{RULE_MARK[shownMode]}</b>
        {variant === "table" ? <span className="storage-rule-word">{RULE_NAME[shownMode]}</span> : null}
        <ChevronDown aria-hidden />
      </button>
      {open ? (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Rule"
          data-tooltip-stop
          className={`storage-rule-list nodrag nowheel ${table ? "storage-rule-list--table" : ""} ${up ? "storage-rule-list--up" : ""}`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {RULE_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              role="option"
              aria-selected={step === shownMode}
              className={`storage-rule-option ${step === shownMode ? "storage-rule-option--on" : ""} ${step === "ignore" ? "storage-rule-option--any" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                rule.choose(step);
              }}
            >
              <b>{RULE_MARK[step]}</b>
              {RULE_NAME[step]}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** Your rate in its sunken box: click to type, scroll to step, middle click
 * to clear. */
export function RateBox({ rule }: { rule: RateRule }) {
  const [box, setBox] = useState<HTMLButtonElement | null>(null);
  const { storage, result, kind, any, target, input, signed, ask, locked, editing } = rule;
  // Native and non-passive, so Ctrl-scroll steps the rate instead of
  // zooming the page; the box is nowheel so the board camera leaves it.
  useNativeWheel(box, (event) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    rule.stepRate(event.deltaY < 0, event);
  });
  const unit = rateSuffixForKind(kind).trim();
  const unreachable = result?.targetUnreachable === true;
  // Signed in Pool, the drawer's direction deciding; a size on the board.
  const value = target === undefined ? 0 : (signed && input ? -1 : 1) * Math.abs(target);
  const shown = `${signed && value !== 0 ? (value < 0 ? "−" : "+") : ""}${formatFieldNumber(value, kind)}`;

  if (editing) {
    return (
      <input
        autoFocus
        value={rule.draft}
        onChange={(event) => rule.setDraft(event.target.value)}
        onBlur={rule.commit}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") rule.cancelEdit();
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={middleDownKeepsFocus}
        onAuxClick={rule.clear}
        inputMode={signed ? "text" : "decimal"}
        placeholder={rule.flowing > 0 ? `${signed && input ? "-" : ""}${draftFor(rule.flowing, kind)}` : "rate"}
        aria-label="Your rate"
        className="storage-rate-field storage-rate-field--editing nodrag"
      />
    );
  }
  return (
    <MinecraftTooltip content={() => <RecipeTooltip view={buildRatePlateTooltip(storage, result, input, rule.flowing, any ? undefined : rule.mode)} />}>
      <button
        ref={setBox}
        type="button"
        className={[
          "storage-rate-field nowheel",
          any ? "storage-rate-field--empty" : "",
          any && ask ? "storage-rate-field--ask animate-pulse" : "",
          !any && unreachable ? "storage-rate-field--bad" : "",
        ].join(" ")}
        disabled={locked}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          rule.beginEdit(any ? undefined : target);
        }}
        onMouseDown={middleDownKeepsFocus}
        onAuxClick={rule.clear}
        aria-label={any ? "Your rate: none. Click to type one." : `Your rate: ${shown} ${unit}. Click to change it.`}
      >
        <span className="storage-rate-field-number">{any ? "rate?" : shown}</span>
        {any ? null : <span className="storage-rate-field-unit">{unit}</span>}
      </button>
    </MinecraftTooltip>
  );
}
