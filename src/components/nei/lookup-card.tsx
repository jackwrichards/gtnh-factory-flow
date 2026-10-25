"use client";

import "../flow/clean/clean.css";
import "./nei-recipe.css";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type { RecipeSummary } from "@/lib/datasets/types";
import {
  AUTO_WORKBENCH_HANDLER_ID,
  formatRate,
  getRecipeMachineHandlers,
  isControllerSlotInput,
  isFreeRecipeInput,
  isOreDictionaryResource,
  isRecipeInputConsumed,
  machineCycleTicks,
} from "@/lib/model";
import type { ResourceAmount } from "@/lib/model/types";
import { energyPerUnitSuffix, type TimeRateUnit } from "@/lib/model/rate-unit";
import { formatCompact, resourceLabel } from "@/lib/model/resources";
import {
  getRecipeProgrammedCircuit,
  isProgrammedCircuitResource,
} from "@/lib/model/programmed-circuit";
import { wheelChangesValues } from "@/lib/device-settings";
import {
  applyAlternativeCycleFace,
  getAlternativeCycleFaces,
  type AlternativeCycleFace,
} from "@/lib/nei/alternative-cycle";
import type { RecipeInputPicks } from "@/store/factory-store";
import { useFactoryStore } from "@/store/factory-store";
import { buildPowerSettingsReader, type PowerSourceDefinition } from "@/lib/power/types";
import type { PowerStencilHit } from "@/lib/power/power-search";
import { resolvePowerResource } from "@/lib/power/planner-data";
import { formatAmount } from "@/lib/power/sources/helpers";
import { circuitNumber } from "../flow/clean/clean-model";
import { fluidSwatchStyle } from "../flow/clean/fluid-swatch";
import { measureClean, mcTextWidth } from "../flow/clean/text-measure";
import { tierChipColors } from "../flow/clean/tokens";
import {
  contextualizePreviewRecipe,
  summaryToPreviewRecipe,
  type PreviewContextResource,
} from "../recipe-preview";
import { itemTipLines, McFloatingTip, type McTipLine } from "./McTip";
import { getFallbackFluidColor, ResourceIcon } from "./ResourceIcon";

/*
 * A recipe in the recipe search drawn as the card it becomes on the board (flow/clean, the mod's flat card), with its
 * machine's picture and count left out: the tab says the machine. Its inputs down the left rail and the power it
 * draws under them, its outputs down the right, its tier on its chip and the time in the head, the plus to add it
 * where the card's menu key is. The card's own classes (clean.css), so it reads as the card it will be.
 */

/**
 * How the cards read their numbers: the recipe as written (amounts per craft), or as rates over the recipe's own
 * duration (one machine, full speed, no overclock: the nameplate figures a board card gets).
 */
// "eu": each OUTPUT row reads the EU one machine spends per unit of it at the recipe's own tier (no overclock). Input
// rows read energy per unit EATEN, so the two sides never look like costs to add up.
export type RateView = "recipe" | TimeRateUnit | "ratio" | "eu";

export const RATE_VIEW_UNITS: Record<TimeRateUnit, { multiplier: number; per: string }> = {
  tick: { multiplier: 1 / 20, per: "t" },
  second: { multiplier: 1, per: "s" },
  minute: { multiplier: 60, per: "min" },
  hour: { multiplier: 3600, per: "hr" },
};

/** Offered by a row whose slot accepts several forms: the menu lists them. */
export interface ChipMenuPicker {
  faces: AlternativeCycleFace[];
  currentId: string;
  onPick: (face: AlternativeCycleFace) => void;
}

/** What every row and card hands back to the search. */
export interface LookupHandlers {
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onChipMenu: (event: ReactMouseEvent, resource: ResourceAmount, picker?: ChipMenuPicker) => void;
  /** A row pressed with the mouse: the stencil may pick it up. */
  onChipDragStart?: (resource: ResourceAmount, event: ReactPointerEvent<HTMLElement>) => void;
  /** The row under the pointer, for R and U. */
  onHoverSlot: (resource: ResourceAmount | undefined) => void;
}

// The card's measures (clean.css): 40 px head, 40 px rows, 112 px rails; here the machine's 88 px well is the arrow's
// 28, so a card is 260 wide.
export const CARD_WIDTH = 260;
const CARD_HEAD = 40;
const CARD_ROW = 40;
const CARD_FOOT = 4;
const WORDS = 70;

/** How many rows a recipe's card has down its two rails. */
export interface CardRows {
  inputs: number;
  outputs: number;
}

/** The rows a recipe's card draws: consumed inputs, kept ones, its power; outputs. The circuit is the head's badge. */
export function recipeCardRows(recipe: RecipeSummary): CardRows {
  const inputs = new Set<string>();
  for (const input of recipe.inputs) {
    if (isProgrammedCircuitResource(input)) continue;
    inputs.add([input.kind, input.id, input.consumed === false ? "nc" : "c"].join("|"));
  }
  return {
    inputs: inputs.size + (recipe.eut > 0 ? 1 : 0),
    outputs: mergeChipResources(recipe.outputs).length,
  };
}

export function powerCardRows(hit: PowerStencilHit): CardRows {
  let model: ReturnType<PowerSourceDefinition["compute"]> | undefined;
  try {
    model = hit.source.compute(buildPowerSettingsReader(hit.source, hit.settings));
  } catch {
    model = undefined;
  }
  const inputs = model?.inputs.filter((flow) => flow.perSecond > 0).length ?? 0;
  const outputs = model?.outputs.filter((flow) => flow.perSecond > 0).length ?? 0;
  return { inputs, outputs: outputs + (model && model.euPerTick > 0 ? 1 : 0) };
}

/** The tallest card of a tab: every card takes its cell, as a handler's recipes do. */
export function cardCellHeight(rows: CardRows[]): number {
  let most = 1;
  for (const entry of rows) most = Math.max(most, entry.inputs, entry.outputs);
  return CARD_HEAD + most * CARD_ROW + CARD_FOOT;
}

/** A figure and its unit fit a row's words at full size (the card's own test, clean-model buildPortView). */
function numberFits(number: string, unit: string): boolean {
  return measureClean(number, 13) + 2 + measureClean(unit, 8) <= WORDS;
}

/**
 * A head's name as the card sizes it (clean-model nameSize): 10 px, else 9, else 8, and at 8 it may take two lines
 * rather than lose its end. The room is the head's less the plus and the tier chip.
 */
function headName(name: string, chip: boolean): { size: number; wrap: boolean } {
  const room = CARD_WIDTH - 8 - (chip ? 48 : 0) - 8 - 8 - 22 - 8;
  const size = [10, 9, 8].find((each) => measureClean(name, each) <= room);
  return size ? { size, wrap: false } : { size: 8, wrap: true };
}

/**
 * One recipe as its board card, machine left out. Rows browse as the card's do (a click for what makes it, a right
 * click or U for what uses it, R too; Shift+right click for the menu), the plus adds it, a double click too.
 */
export const LookupRecipeCard = memo(function LookupRecipeCard({
  recipe,
  contextResource,
  rateView,
  onSelectRecipe,
  onAdd,
  onPrefetch,
  onCardMenu,
  handlers,
}: {
  recipe: RecipeSummary;
  contextResource?: PreviewContextResource;
  rateView: RateView;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (
    recipe: RecipeSummary,
    machineHandlerId?: string,
    inputPicks?: RecipeInputPicks,
  ) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  /** Right click on the card (or a held press on its head): its menu. */
  onCardMenu: (event: ReactMouseEvent, add: () => void) => void;
  handlers: LookupHandlers;
}) {
  const preview = useMemo(
    () => contextualizePreviewRecipe(summaryToPreviewRecipe(recipe), contextResource),
    [contextResource, recipe],
  );
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const machineHandlers = useMemo(() => getRecipeMachineHandlers(preview), [preview]);
  const primary = machineHandlers[0];
  // A dataset recipe is written in its primary machine's numbers already; the synthesized Auto Workbench is the one
  // handler that brings its own (the crafting maps are exported instant), so the card and its rate views read the
  // workbench's LV seed instead of claiming twenty crafts a second.
  const isAutoWorkbench = primary?.id === AUTO_WORKBENCH_HANDLER_ID;
  // A machine on its own fixed cycle (the Extreme Heat Exchanger) states its amounts per cycle, whatever duration the
  // recipe was exported with.
  const durationTicks =
    machineCycleTicks(primary?.machineType) ??
    (isAutoWorkbench && primary.durationTicks !== undefined
      ? primary.durationTicks
      : recipe.durationTicks);
  const eut = isAutoWorkbench ? (primary.eut ?? recipe.eut) : recipe.eut;
  const minimumTier = isAutoWorkbench ? primary.minimumTier : recipe.minimumTier;
  const seconds = durationTicks / 20;
  const circuit = useMemo(() => getRecipeProgrammedCircuit(preview), [preview]);

  // Crafting-grid recipes arrive one slot at a time, so identical items merge with their amounts summed. Dictionary
  // groups keep their identity while their icons cycle; explicit concrete picks still ride onto the board.
  const [inputPicks, setInputPicks] = useState<RecipeInputPicks>({});
  const inputChips = useMemo(() => {
    const merged = new Map<string, { raw: (typeof preview.inputs)[number]; indexes: number[] }>();
    preview.inputs.forEach((input, index) => {
      const key = [input.kind, input.id, input.consumed === false ? "nc" : "c"].join("|");
      const entry = merged.get(key);
      if (entry) {
        entry.raw = { ...entry.raw, amount: entry.raw.amount + input.amount };
        entry.indexes.push(index);
      } else {
        merged.set(key, { raw: { ...input }, indexes: [index] });
      }
    });
    return [...merged.values()].map(({ raw, indexes }) => {
      // Dictionary members preview interchangeably; concrete substitutes keep their picker because their quantities
      // can differ.
      const faces = isOreDictionaryResource(raw) ? [] : getAlternativeCycleFaces(raw);
      const face = inputPicks[indexes[0]] ?? faces[0];
      return {
        raw,
        indexes,
        faces,
        resource: face ? applyAlternativeCycleFace(raw, face) : raw,
      };
    });
  }, [inputPicks, preview]);
  const outputChips = useMemo(() => mergeChipResources(preview.outputs), [preview]);
  // A chanced output counts what it gives on average: 1 at 25% reads 0.25, as the board's rates read it.
  const expected = <T extends ResourceAmount & { chance?: number }>(output: T): T =>
    output.chance !== undefined && output.chance < 1
      ? { ...output, amount: output.amount * output.chance }
      : output;
  // The RATIO reading: every counted amount over their shared divisor, so 2 dust into 2 ingots says 1 and 1. Catalysts
  // stay out of the arithmetic, and any non-whole amount (a substitute's scaled cost) leaves the recipe unreduced
  // rather than lying about it.
  const ratioDivisor = useMemo(() => {
    if (rateView !== "ratio") {
      return 1;
    }
    let divisor = 0;
    const amounts = [
      ...inputChips
        .filter((chip) => isRecipeInputConsumed(chip.raw))
        .map((chip) => chip.resource.amount),
      ...outputChips.map((output) => expected(output).amount),
    ];
    for (const amount of amounts) {
      if (!Number.isInteger(amount) || amount <= 0) {
        return 1;
      }
      divisor = greatestCommonDivisor(divisor, amount);
    }
    return divisor > 0 ? divisor : 1;
  }, [inputChips, outputChips, rateView]);
  // A merged row stands for every slot it swallowed, so a pick lands on all of their indexes at once.
  const pickFace = useCallback((indexes: number[], face: AlternativeCycleFace) => {
    setInputPicks((previous) => {
      const next = { ...previous };
      for (const index of indexes) {
        next[index] = face;
      }
      return next;
    });
  }, []);

  // A pointer that settles on a card is probably about to press its plus, so the full recipe starts travelling now.
  // The short fuse keeps a pointer sweeping across the page from requesting every card it crosses.
  const prefetchTimerRef = useRef<number | undefined>(undefined);
  const cancelPrefetch = useCallback(() => {
    if (prefetchTimerRef.current !== undefined) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = undefined;
    }
  }, []);
  const armPrefetch = useCallback(() => {
    if (!onPrefetch) {
      return;
    }
    cancelPrefetch();
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = undefined;
      onPrefetch(recipe.id);
    }, 150);
  }, [cancelPrefetch, onPrefetch, recipe.id]);
  useEffect(() => cancelPrefetch, [cancelPrefetch]);
  const add = () => void onAdd(recipe, undefined, inputPicks);
  const openMenu = (event: ReactMouseEvent) => onCardMenu(event, add);
  const headPress = useLongPress(openMenu);

  const used = inputChips.filter(
    (chip) => !isProgrammedCircuitResource(chip.raw) && isRecipeInputConsumed(chip.raw),
  );
  const kept = inputChips.filter(
    (chip) => !isProgrammedCircuitResource(chip.raw) && !isRecipeInputConsumed(chip.raw),
  );
  const byKind = <T,>(list: T[], kindOf: (entry: T) => string) => [
    ...list.filter((entry) => kindOf(entry) !== "fluid"),
    ...list.filter((entry) => kindOf(entry) === "fluid"),
  ];

  const inputRow = (chip: (typeof inputChips)[number], key: string) => {
    const picker: ChipMenuPicker | undefined =
      chip.faces.length > 1
        ? {
            faces: chip.faces,
            currentId: chip.resource.id,
            onPick: (face) => pickFace(chip.indexes, face),
          }
        : undefined;
    const keptHere = !isRecipeInputConsumed(chip.raw);
    const free = keptHere && isFreeRecipeInput(chip.raw) && !isControllerSlotInput(chip.raw);
    const amount: ChipAmount = keptHere
      ? { text: free ? "free" : "not used up" }
      : rateView === "eu"
        ? formatChipEnergy(chip.resource, "input", eut, durationTicks)
        : formatChipAmount(chip.resource, rateView, durationTicks, ratioDivisor);
    return (
      <LookupRow
        key={key}
        side="input"
        resource={chip.resource}
        amount={amount}
        kept={keptHere}
        tip={keptHere ? (free ? "Free: nothing is spent" : "Not used up") : undefined}
        picker={picker}
        onCycle={
          picker
            ? (step) => {
                const at = Math.max(
                  0,
                  chip.faces.findIndex((face) => face.id === chip.resource.id),
                );
                const next = chip.faces[(at + step + chip.faces.length) % chip.faces.length];
                pickFace(chip.indexes, next);
              }
            : undefined
        }
        handlers={handlers}
      />
    );
  };

  const tier = eut > 0 ? minimumTier : undefined;
  return (
    <article
      data-recipe=""
      className="cc-card nrw-card"
      style={{ width: CARD_WIDTH }}
      onClick={() => onSelectRecipe(recipe.id)}
      onDoubleClick={() => {
        if (!isReadOnly) add();
      }}
      onContextMenu={openMenu}
      onPointerEnter={armPrefetch}
      onPointerLeave={cancelPrefetch}
    >
      <CardHead
        add={add}
        readOnly={isReadOnly}
        label="Add recipe node"
        tier={tier}
        circuit={circuit}
        press={headPress}
      >
        <div className="cc-name nrw-card-time">{`${formatRate(seconds, seconds >= 10 ? 0 : 1)} s`}</div>
      </CardHead>
      <div className="cc-rail" data-side="input">
        {byKind(used, (chip) => chip.resource.kind).map((chip, index) =>
          inputRow(chip, `in-${index}`),
        )}
        {kept.map((chip, index) => inputRow(chip, `kept-${index}`))}
        {eut > 0 ? <PowerRow number={eut.toLocaleString()} unit="EU/t" /> : null}
      </div>
      <CardArrow />
      <div className="cc-rail" data-side="output">
        {byKind(outputChips, (output) => output.kind).map((output, index) => {
          const average = expected(output);
          const amount =
            rateView === "eu"
              ? formatChipEnergy(average, "output", eut, durationTicks)
              : formatChipAmount(average, rateView, durationTicks, ratioDivisor);
          const chance = "chance" in output ? output.chance : undefined;
          return (
            <LookupRow
              key={`out-${index}`}
              side="output"
              resource={output}
              amount={amount}
              chance={chance}
              handlers={handlers}
            />
          );
        })}
      </div>
    </article>
  );
});

/**
 * A generator answering the stencil, as its board card: its name in the head, what it burns down the left, the EU it
 * makes first down the right, the settings that matched under the rails. The plus places it with those settings.
 */
export function LookupPowerCard({
  hit,
  rateView,
  onPlace,
  onCardMenu,
  handlers,
}: {
  hit: PowerStencilHit;
  rateView: RateView;
  onPlace: () => void;
  onCardMenu: (event: ReactMouseEvent) => void;
  handlers: LookupHandlers;
}) {
  const headPress = useLongPress(onCardMenu);
  const model = useMemo(() => {
    try {
      return hit.source.compute(buildPowerSettingsReader(hit.source, hit.settings));
    } catch {
      return undefined;
    }
  }, [hit]);
  const name = headName(hit.source.name, hit.source.unlock !== undefined);
  const flowRow = (direction: "takes" | "makes", flow: { name: string; perSecond: number }) => {
    const resolved = resolvePowerResource(flow.name);
    const resource = resolved
      ? ({ ...resolved, amount: flow.perSecond } as ResourceAmount)
      : undefined;
    const amount = formatPowerChipAmount(resolved?.kind ?? "item", flow.perSecond, rateView);
    if (!resource) {
      // A flow with no dataset resource still shows, inert.
      return (
        <div
          key={`${direction}:${flow.name}`}
          className="cc-row"
          data-side={direction === "takes" ? "input" : "output"}
        >
          <span className="cc-num" data-unit={amount.unit ?? ""}>
            {amount.text}
          </span>
          <span className="cc-pname">{flow.name}</span>
        </div>
      );
    }
    return (
      <LookupRow
        key={`${direction}:${flow.name}`}
        side={direction === "takes" ? "input" : "output"}
        resource={resource}
        amount={amount}
        handlers={handlers}
      />
    );
  };
  const inputs = model?.inputs.filter((flow) => flow.perSecond > 0) ?? [];
  const outputs = model?.outputs.filter((flow) => flow.perSecond > 0) ?? [];
  return (
    <article
      data-recipe=""
      className="cc-card nrw-card"
      style={{ width: CARD_WIDTH }}
      onDoubleClick={onPlace}
      onContextMenu={onCardMenu}
    >
      <CardHead
        add={onPlace}
        label={`Add ${hit.source.name}`}
        tier={hit.source.unlock}
        press={headPress}
      >
        <div
          className="cc-name nrw-card-named"
          data-wrap={name.wrap ? "" : undefined}
          style={{ "--cc-name-size": `${name.size}px` } as CSSProperties}
        >
          {hit.source.name}
        </div>
      </CardHead>
      <div className="cc-rail" data-side="input">
        {inputs.map((flow) => flowRow("takes", flow))}
      </div>
      <CardArrow />
      <div className="cc-rail" data-side="output">
        {model && model.euPerTick > 0 ? (
          <PowerRow number={formatAmount(model.euPerTick)} unit="EU/t" side="output" />
        ) : null}
        {outputs.map((flow) => flowRow("makes", flow))}
      </div>
    </article>
  );
}

/** A card still on its way: the head and two empty tiles, breathing on a stagger. */
export function LookupSkeletonCard({ delay }: { delay: number }) {
  // NEGATIVE delay: a positive one leaves the card at full base opacity until its turn, then snaps it into the cycle.
  // Starting every card mid-cycle gives the same ripple with nothing to snap.
  const delayStyle: CSSProperties = { animationDelay: `-${delay}ms`, width: CARD_WIDTH };
  return (
    <div className="cc-card nrw-card recipe-search-skeleton" style={delayStyle} aria-hidden>
      <div className="cc-head">
        <span className="nrw-card-ghost" style={{ width: 56 }} />
      </div>
      <div className="cc-rail" data-side="input">
        <div className="cc-row" data-side="input" />
      </div>
      <CardArrow />
      <div className="cc-rail" data-side="output">
        <div className="cc-row" data-side="output" />
      </div>
    </div>
  );
}

/** The card's head with the machine left out: the plus where the menu key is, then the words, the circuit, the tier. */
function CardHead({
  add,
  readOnly = false,
  label,
  tier,
  circuit,
  press,
  children,
}: {
  add: () => void;
  readOnly?: boolean;
  label: string;
  tier?: string;
  circuit?: ReturnType<typeof getRecipeProgrammedCircuit>;
  press: ReturnType<typeof useLongPress>;
  children: ReactNode;
}) {
  const chip = tier ? tierChipColors(tier) : undefined;
  const number = circuit ? circuitNumber(circuit) : undefined;
  return (
    <div className="cc-head" {...press.handlers}>
      <div
        role="button"
        tabIndex={readOnly ? -1 : 0}
        className="cc-key"
        data-glyph="plus"
        aria-label={label}
        aria-disabled={readOnly || undefined}
        title={readOnly ? "Open a copy to add recipes" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (press.consumeClick() || readOnly) {
            return;
          }
          add();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !readOnly) {
            event.preventDefault();
            add();
          }
        }}
      />
      {children}
      <span className="nrw-grow" />
      {circuit?.resource ? (
        <span className="nrw-card-circuit" title={number ? `Circuit ${number}` : "Circuit"}>
          <ResourceIcon
            itemZoom={1.5}
            resource={{ ...circuit.resource, amount: 1, chance: undefined }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            className="nrw-card-circuit-icon"
          />
        </span>
      ) : null}
      {chip ? (
        <div
          className="cc-chip"
          data-fixed=""
          data-underline={chip.underline ? "" : undefined}
          style={
            {
              "--chip-bg": chip.background,
              "--chip-border": chip.border,
              "--chip-ink": chip.ink,
              "--chip-hover": chip.background,
              "--chip-pressed": chip.background,
            } as CSSProperties
          }
        >
          {tier}
        </div>
      ) : null}
    </div>
  );
}

/** The power a card draws (or a generator makes): the card's bolt tile. */
function PowerRow({
  number,
  unit,
  side = "input",
}: {
  number: string;
  unit: string;
  side?: "input" | "output";
}) {
  return (
    <div className="cc-row" data-power="" data-side={side}>
      <span className="cc-bolt" />
      <span
        className="cc-num"
        data-unit={unit}
        data-small={numberFits(number, unit) ? undefined : ""}
      >
        {number}
      </span>
      <span className="cc-pname">Power</span>
    </div>
  );
}

/** NEI's progress arrow where the machine's well would be. */
function CardArrow() {
  return (
    <span className="nrw-card-arrow" aria-hidden>
      <svg viewBox="0 0 22 15" width="22" height="15" fill="currentColor">
        <path d="M0 5h13V0l9 7.5-9 7.5v-5H0z" />
      </svg>
    </span>
  );
}

/**
 * One row of a card: the item or the fluid's square, the amount in the reading in use, the name under it. A click asks
 * what makes it and a right click what uses it (R and U over it too); a Shift right click or a held press opens every
 * way to use it; pressed and moved, it lifts onto the stencil; the wheel steps a slot that takes several forms.
 */
function LookupRow({
  side,
  resource,
  amount,
  chance,
  kept = false,
  tip,
  picker,
  onCycle,
  handlers,
}: {
  side: "input" | "output";
  resource: ResourceAmount;
  amount: ChipAmount;
  chance?: number;
  /** In the machine and not used up (a mold, a lens): drawn as the card draws a free input. */
  kept?: boolean;
  /** A line of its own in the tooltip. */
  tip?: string;
  picker?: ChipMenuPicker;
  onCycle?: (step: 1 | -1) => void;
  handlers: LookupHandlers;
}) {
  const { onBrowseResource, onChipMenu, onChipDragStart, onHoverSlot } = handlers;
  // The wheel listener is attached by hand, non-passive: React's synthetic wheel cannot preventDefault, and without it
  // every cycle also turns the page.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = rootRef.current;
    if (!element || !onCycle) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      const delta = event.deltaY || event.deltaX;
      if (!delta || !wheelChangesValues()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCycle(delta > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onCycle]);

  const menu = (event: ReactMouseEvent) => onChipMenu(event, { ...resource, amount: 1 }, picker);
  const press = useLongPress(menu);
  const [hover, setHover] = useState<{ x: number; y: number }>();
  const name = resourceLabel(resource);
  const chanceText =
    chance !== undefined && chance < 1 ? `${Math.round(chance * 1000) / 10}%` : undefined;
  const consumeChance = (resource as { consumeChance?: number }).consumeChance;
  const consumeText =
    consumeChance !== undefined && consumeChance < 1
      ? `Used up ${Math.round(consumeChance * 1000) / 10}% of runs, counted in`
      : undefined;
  const unit = amount.unit ?? "";
  const nameSmall = mcTextWidth(name) > 71;
  const nameWraps = measureClean(name, nameSmall ? 6 : 8) > WORDS;
  const numberSmall = kept || !numberFits(amount.text, unit);
  const lines = useMemo<McTipLine[] | undefined>(() => {
    if (!hover) return undefined;
    const reading = kept
      ? undefined
      : amount.unit
        ? `${amount.text}${amount.unit.startsWith("/") ? "" : " "}${amount.unit}`
        : amount.text;
    const extra = [
      ...(reading ? [reading] : []),
      ...(tip ? [tip] : []),
      ...(chanceText ? [`${chanceText} chance, counted in`] : []),
      ...(consumeText ? [consumeText] : []),
    ];
    const out = itemTipLines({ name, id: resource.id, tooltip: resource.tooltip, extra });
    if (picker) out.splice(1, 0, { text: "Scroll to change it", tone: "hint" });
    return out;
  }, [
    amount.text,
    amount.unit,
    chanceText,
    consumeText,
    hover,
    kept,
    name,
    picker,
    resource.id,
    resource.tooltip,
    tip,
  ]);

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      className="cc-row nrw-port"
      data-port=""
      data-side={side}
      data-kept={kept ? "" : undefined}
      data-choice={picker ? "" : undefined}
      aria-label={name}
      {...press.handlers}
      onPointerDown={(event) => {
        press.handlers.onPointerDown(event);
        onChipDragStart?.(resource, event);
      }}
      onMouseEnter={() => onHoverSlot(resource)}
      onMouseMove={(event) =>
        setHover(event.buttons === 0 ? { x: event.clientX, y: event.clientY } : undefined)
      }
      onMouseLeave={() => {
        setHover(undefined);
        onHoverSlot(undefined);
      }}
      onClick={(event) => {
        event.stopPropagation();
        // The tap that ends a long press is not a second gesture.
        if (press.consumeClick()) {
          return;
        }
        onBrowseResource({ ...resource, amount: 1 }, "recipes");
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onBrowseResource({ ...resource, amount: 1 }, "recipes");
        }
      }}
      onContextMenu={(event) => {
        if (event.shiftKey) {
          menu(event);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onBrowseResource({ ...resource, amount: 1 }, "uses");
      }}
    >
      <RowIcon resource={resource} />
      <span
        className="cc-num"
        data-unit={unit}
        data-small={numberSmall ? "" : undefined}
        data-energy={amount.energy ? "" : undefined}
      >
        {amount.text}
      </span>
      <span
        className="cc-pname"
        data-small={nameSmall || nameWraps || undefined}
        data-wrap={nameWraps || undefined}
      >
        {name}
      </span>
      {lines && hover ? <McFloatingTip x={hover.x} y={hover.y} lines={lines} /> : null}
    </div>
  );
}

/** A row's picture, as the card draws it: an item's sprite, a fluid's flat square in its own colour. */
function RowIcon({ resource }: { resource: ResourceAmount }) {
  if (resource.kind === "fluid") {
    const color =
      resource.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      getFallbackFluidColor(resource.id);
    return (
      <span
        className="cc-icon cc-swatch"
        role="img"
        aria-label={resource.displayName}
        style={fluidSwatchStyle({ ...resource, dominantColor: color })}
      />
    );
  }
  return (
    <ResourceIcon
      itemZoom={1.5}
      bare
      tooltip={false}
      showAmount={false}
      showConsumedState={false}
      resource={{ ...resource, amount: 1, chance: undefined }}
      className="cc-icon"
    />
  );
}

/**
 * iOS never fires contextmenu, so a held touch press (450ms, as on port rows) opens the menu. Spread the handlers onto
 * the element and call `consumeClick` first in its click: the tap ending a long press is not a second gesture.
 */
export function useLongPress(onMenu: (event: ReactMouseEvent) => void) {
  const pressTimerRef = useRef<number | undefined>(undefined);
  const pressStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const longPressFiredRef = useRef(false);
  const clearPress = useCallback(() => {
    pressStartRef.current = undefined;
    if (pressTimerRef.current !== undefined) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = undefined;
    }
  }, []);
  useEffect(() => clearPress, [clearPress]);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }
    const at = { clientX: event.clientX, clientY: event.clientY };
    clearPress();
    pressStartRef.current = { x: event.clientX, y: event.clientY };
    longPressFiredRef.current = false;
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = undefined;
      longPressFiredRef.current = true;
      onMenu({
        ...at,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      } as ReactMouseEvent);
    }, 450);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    // A finger always jitters; only a real slide cancels the press.
    const start = pressStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      clearPress();
    }
  };
  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clearPress,
      onPointerCancel: clearPress,
    },
    consumeClick: () => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return true;
      }
      return false;
    },
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Per-second power flows in the reading in use; no craft, no ratio. */
function formatPowerChipAmount(kind: string, perSecond: number, rateView: RateView): ChipAmount {
  const unit =
    rateView === "recipe" || rateView === "ratio" || rateView === "eu"
      ? RATE_VIEW_UNITS.second
      : RATE_VIEW_UNITS[rateView];
  const per = unit.per;
  const value = perSecond * unit.multiplier;
  const text = trimTrailingZeros(formatRate(value, value >= 100 ? 0 : value >= 10 ? 1 : 2));
  return kind === "fluid" ? { text, unit: `L/${per}` } : { text, unit: `/${per}` };
}

/** An oredict slot wears its first concrete face: the row is a thing you can click, not the dictionary's own name. */
function chipFaceResource<T extends ResourceAmount>(resource: T): T {
  const face = isOreDictionaryResource(resource) ? resource.alternatives?.[0] : undefined;
  if (!face) {
    return resource;
  }
  return {
    ...resource,
    kind: face.kind,
    id: face.id,
    displayName: face.displayName ?? resource.displayName,
    iconPath: face.iconPath ?? resource.iconPath,
    iconAtlas: face.iconAtlas ?? resource.iconAtlas,
    dominantColor: face.dominantColor ?? face.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

/**
 * Crafting-grid recipes list one entry per slot; the same item nine times is one row saying ×9. Non-consumed entries
 * and chanced outputs keep their own rows, because merging those would change what the numbers mean.
 */
export function mergeChipResources<
  T extends ResourceAmount & { consumed?: boolean; chance?: number },
>(resources: T[]): T[] {
  const merged = new Map<string, T>();
  for (const raw of resources) {
    const resource = chipFaceResource(raw);
    const key = [
      resource.kind,
      resource.id,
      resource.consumed === false ? "nc" : "c",
      resource.chance ?? 1,
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, amount: existing.amount + resource.amount });
    } else {
      merged.set(key, resource);
    }
  }
  return [...merged.values()];
}

/** A row's number and, apart from it, the quieter unit it is counted in. */
interface ChipAmount {
  text: string;
  unit?: string;
  /** An EU-per-unit reading, drawn in the board's gold on either side. */
  energy?: "input" | "output";
}

/**
 * The EU view's row: one craft's energy (EU/t x ticks) over the amount this row makes (or eats) per craft. A chanced
 * output comes in at its average amount. A recipe with no power or no time reads 0.
 */
function formatChipEnergy(
  resource: ResourceAmount,
  side: "input" | "output",
  eut: number,
  durationTicks: number,
): ChipAmount {
  const perUnit =
    resource.amount > 0 ? (Math.max(0, eut) * Math.max(0, durationTicks)) / resource.amount : 0;
  return {
    text: formatCompact(perUnit),
    unit: energyPerUnitSuffix(resource.kind).trim(),
    energy: side,
  };
}

/** "7.0" is 7 and "7.50" is 7.5: a trailing zero says nothing. */
function trimTrailingZeros(text: string): string {
  return text.includes(".") ? text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : text;
}

function formatChipAmount(
  resource: ResourceAmount,
  rateView: RateView,
  durationTicks: number,
  ratioDivisor = 1,
): ChipAmount {
  // Ratio: lowest terms, no time, no unit prefix - a 1:1 recipe says 1 and 1, not x1 and x1. Fluids keep their L so a
  // litre never reads as an item.
  if (rateView === "ratio") {
    const reduced = resource.amount / ratioDivisor;
    return resource.kind === "fluid"
      ? { text: reduced.toLocaleString(), unit: "L" }
      : { text: reduced.toLocaleString() };
  }

  // The EU view reads INPUTS as written (see the RateView note).
  if (rateView === "recipe" || rateView === "eu" || durationTicks <= 0) {
    if (resource.kind === "fluid") {
      return { text: resource.amount.toLocaleString(), unit: "L" };
    }
    return { text: `×${resource.amount.toLocaleString()}` };
  }

  const unit = RATE_VIEW_UNITS[rateView];
  const value = ((resource.amount * 20) / durationTicks) * unit.multiplier;
  const text = trimTrailingZeros(formatRate(value, value >= 100 ? 0 : value >= 10 ? 1 : 2));
  return resource.kind === "fluid"
    ? { text, unit: `L/${unit.per}` }
    : { text, unit: `/${unit.per}` };
}
