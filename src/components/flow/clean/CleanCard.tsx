"use client";

import "./clean.css";
import { fluidSwatchStyle } from "./fluid-swatch";

import { Handle, Position } from "@xyflow/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type WheelEvent,
} from "react";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import {
  fluidArtPixels,
  getFallbackFluidColor,
  isSwatchFluid,
  ResourceIcon,
} from "@/components/nei/ResourceIcon";
import { type BrowseMode as PortBrowseMode } from "@/components/browse-menu";
import { useFactoryStore } from "@/store/factory-store";
import { useCardTaskStatus } from "@/lib/tasks/task-link-index";
import { TASK_STATUS_COLOR } from "@/lib/tasks/task-links";
import { buildPortFlowScope } from "../flow-scope";
import { usePortRowBrowse } from "../use-port-row-browse";
import { isWiringConnection } from "../connection-drag";
import { CardActionsMenu } from "./menus/CardActionsMenu";
import { openAddToTask } from "@/components/tasks/AddToTask";
import { cardsForTask } from "@/lib/tasks/make-task";
import { isLiveConfigured } from "@/lib/live/live-config";

/** Task boards come with live plans: no Add to a task row without them. */
const TASKS_ENABLED = isLiveConfigured();
import { checklistLocked } from "../RecipeNode";
import { wheelChangesValues } from "@/lib/device-settings";
import { MobPickerMenu } from "../MobPickerMenu";
import { isControllerSlotInput } from "@/lib/model/free-input";
import type {
  CleanCardActions,
  CleanCardContext,
  CleanCardView,
  CleanChipView,
  CleanFootView,
  CleanPortView,
} from "./clean-model";
import {
  circuitNumber,
  frameTone,
  LIVE_TYPE_MS,
  parseCountText,
  reasonStripes,
  wheelDraft,
} from "./clean-model";
import { glanceFace } from "./glance";
import type { PinRule } from "@/lib/model/pin-rule";
import { CountRuleMenu } from "./menus/CountRuleMenu";
import { tierChipColors } from "./tokens";
import { syncPromptPhase } from "../virtual/prompt-phase";
import { ensureInteractionHost, useClickSlop, tipAttrs, type TipSpec } from "./interaction";
import { PortRateControls } from "./interaction/PortRateControls";
import { useNativeWheel } from "./interaction/native-wheel";
import { setSpillHover, useSpillHover } from "./interaction/spill-hover";
import { forcedTip, menuTip, portTip, powerPanelTip } from "./interaction/tips";
import { gearTip } from "./menus/card-tips";
import { openSparePopupForPort } from "./rail/SparePopup";
import { makePortKey } from "@/lib/solver/plan/port-key";
// FX2 registration: the compact menus, the gear sheet and the richer tips live in ./menus (portal, no card DOM).
import { MachineListMenu } from "./menus/MachineListMenu";
import { OptionListMenu } from "./menus/OptionListMenu";
import { SettingsSheet } from "./menus/SettingsSheet";
import { useDeviceSettings } from "@/lib/device-settings";
import { anchorOf, type MenuAnchor } from "./menus/MenuPortal";
import { cloneWithSound, playEditSfx, sfxClick, sfxTick } from "@/lib/sound/sfx";
import {
  countRowsTip,
  footTip,
  machineNameTip,
  powerRowTip,
  ruleTip,
  stripTip,
  tierChipTip,
  useCardTipFacts,
} from "./menus/card-tips";
import {
  recipeHeatNeed,
  settingControls,
  settingPatch,
  steppedOption,
  type SettingControl,
} from "./menus/settings-model";

export function glyph(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

/** One input or output row. A component of its own so hover scope and resource lighting re-render only it. */
export function CleanPortRow({
  p,
  wasClick,
  unset = false,
}: {
  p: CleanPortView;
  wasClick: (event: MouseEvent) => boolean;
  unset?: boolean;
}) {
  const browseResource = useFactoryStore((state) => state.browseResource);
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  const scopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.ports[`${p.nodeId}|${p.handleId}`]),
  );
  const resourceLit = useFactoryStore(
    (state) => (state.hoveredFlowResourceKey ?? state.selectedFlowResourceKey) === p.resourceKey,
  );
  // This row's Forced tile lights with the rest of its spill (the buffer's tile and its other makers').
  const spillLit = useSpillHover((state) => p.spillTo !== undefined && state.drawerId === p.spillTo);
  const [mobOpen, setMobOpen] = useState(false);
  const { port } = p;
  const isInput = p.side === "input";
  const browse = (mode: PortBrowseMode) => {
    if (port.kind === "power") return;
    browseResource(
      {
        kind: port.kind,
        id: port.resourceId,
        displayName: port.resource?.displayName ?? port.displayName,
        iconPath: port.resource?.iconPath,
        iconAtlas: port.resource?.iconAtlas,
        dominantColor: port.resource?.dominantColor ?? port.resource?.iconAtlas?.dominantColor,
        anchorNodeId: p.nodeId,
      },
      mode,
    );
  };
  const rowBrowse = usePortRowBrowse({ nodeId: p.nodeId, port, browse });
  const lit = scopeLit || resourceLit;
  const iconProps = {
    itemZoom: 1.5,
    bare: true,
    tooltip: false,
    showAmount: false,
    showConsumedState: false,
    iconPixelSize:
      port.kind === "fluid" && port.resource
        ? isSwatchFluid(port.resource)
          ? 50
          : fluidArtPixels(32)
        : undefined,
  } as const;

  if (port.free) {
    // The item in a machine's controller slot (the Extreme Entity Crusher's spawner) names its mob: pressing it picks another.
    const controller = port.resource !== undefined && isControllerSlotInput(port.resource);
    // The game gives this one away: shown so it is set down beside the machine, nothing to wire.
    return (
      <div
        className="cc-row"
        data-side={p.side}
        data-controller={controller ? "" : undefined}
        title={controller ? undefined : `${p.name}: free input, no supply needed`}
        style={{ opacity: controller ? 0.85 : 0.6 }}
        {...(controller
          ? {
              role: "button",
              tabIndex: 0,
              "data-mob-picker-toggle": "",
              "aria-haspopup": "dialog" as const,
              "aria-expanded": mobOpen,
              ...tipAttrs({
                id: `${p.nodeId}|controller|${p.handleId}`,
                title: p.name,
                sub: "Controller slot",
                notes: [
                  { text: "Goes in the machine's controller slot. Never used up.", tone: "muted" },
                ],
                actions: [{ input: "left", label: "Put in another mob" }],
              }),
              onClick: (event: MouseEvent) => {
                event.stopPropagation();
                if (wasClick(event) && !checklistLocked()) setMobOpen((open) => !open);
              },
            }
          : {})}
      >
        {port.resource ? <PortIcon resource={port.resource} iconProps={iconProps} /> : null}
        <span className="cc-num" data-small="" data-unit="">
          {controller ? "in controller" : "free"}
        </span>
        <span
          className="cc-pname"
          data-small={p.nameSmall || undefined}
          data-clip={p.nameClipped || undefined}
        >
          {p.name}
        </span>
        {controller && mobOpen ? (
          <MobPickerMenu nodeId={p.nodeId} onClose={() => setMobOpen(false)} />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="cc-row"
      data-port=""
      data-side={p.side}
      data-wired={p.wired ? "true" : "false"}
      data-open={!p.wired && !p.zero ? "" : undefined}
      data-lit={lit ? "" : undefined}
      data-forced={p.forced ? "" : undefined}
      data-why={p.why}
      style={whyStyle(p.why)}
      data-choice={p.choice ? "" : undefined}
      data-resource-edge-anchor="true"
      data-resource-node-id={p.nodeId}
      data-resource-handle-id={p.handleId}
      {...tipAttrs(portTip(p))}
      onPointerEnter={() => {
        rowBrowse.handlers.onPointerEnter();
        if (!isWiringConnection() && !checklistLocked()) {
          setHoveredFlowScope(
            buildPortFlowScope(useFactoryStore.getState().project, p.nodeId, port),
          );
          if (p.spillTo !== undefined) setSpillHover(p.spillTo);
        }
      }}
      onPointerLeave={() => {
        rowBrowse.handlers.onPointerLeave();
        setHoveredFlowScope(undefined);
        if (p.spillTo !== undefined) setSpillHover(undefined);
      }}
      onPointerDown={rowBrowse.handlers.onPointerDown}
      onPointerMove={rowBrowse.handlers.onPointerMove}
      onPointerUp={rowBrowse.handlers.onPointerUp}
      onPointerCancel={rowBrowse.handlers.onPointerCancel}
      onClick={(event) => {
        if (!wasClick(event)) return;
        // The port's handle covers the whole row, the Forced strip too, so a click there arrives here: it is the strip's.
        const strip = p.forced
          ? event.currentTarget.querySelector(".cc-forced")?.getBoundingClientRect()
          : undefined;
        if (
          strip &&
          event.clientY >= strip.top &&
          event.clientY <= strip.bottom &&
          openSparePopupForPort(
            makePortKey(p.nodeId, isInput ? "i" : "o", p.handleId),
            event.clientX,
            event.clientY,
          )
        ) {
          event.stopPropagation();
          return;
        }
        rowBrowse.handlers.onClick(event);
      }}
      onContextMenu={rowBrowse.handlers.onContextMenu}
    >
      {p.forced ? (
        <div className="cc-line">
          <Words p={p} iconProps={iconProps} />
        </div>
      ) : (
        <Words p={p} iconProps={iconProps} />
      )}
      {p.forced ? (
        <div
          className="cc-forced"
          data-kind={isInput ? "in" : "out"}
          data-lit={spillLit ? "" : undefined}
          {...tipAttrs(forcedTip(p))}
          onClick={(event) => {
            // A leftover with somewhere else to go opens its split (rail/SparePopup.tsx).
            if (
              wasClick(event) &&
              openSparePopupForPort(
                makePortKey(p.nodeId, isInput ? "i" : "o", p.handleId),
                event.clientX,
                event.clientY,
              )
            ) {
              event.stopPropagation();
            }
          }}
        >
          {port.resource ? <PortIcon resource={port.resource} iconProps={iconProps} /> : null}
          <span className="cc-num" data-unit={p.forced.unit}>
            {p.forced.number}
          </span>
          <span className="cc-pname">Forced</span>
        </div>
      ) : null}
      {!p.wired && !p.forced && port.kind !== "power" ? (
        <PortRateControls p={p} unset={unset} wasClick={wasClick} />
      ) : null}
      <Handle
        id={p.handleId}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        data-resource-handle="true"
        data-resource-node-id={p.nodeId}
        data-resource-handle-id={p.handleId}
        aria-label={`${isInput ? "Input" : "Output"}: ${p.name}${readOnly ? "" : ". Left click or R for recipes, right click or U for uses, drag to connect"}`}
        className={[
          "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
          "!rounded-none !border-0 !bg-transparent !opacity-0",
          readOnly ? "cursor-default" : "cursor-crosshair",
        ].join(" ")}
      />
      {rowBrowse.menu}
    </div>
  );
}

/** A lit row's stripes in its reason's colour, as custom properties (clean.css `.cc-row[data-why]`). */
function whyStyle(why: CleanPortView["why"]): CSSProperties | undefined {
  const stripes = why ? reasonStripes(why) : undefined;
  return stripes
    ? ({ "--cc-why-body": stripes.body, "--cc-why-stripe": stripes.stripe } as CSSProperties)
    : undefined;
}

/**
 * A port's picture: an item's sprite, or for a fluid the mod's flat square in the fluid's own colour
 * (one span, no art, no bevel).
 */
function PortIcon({
  resource,
  iconProps,
}: {
  resource: NonNullable<CleanPortView["port"]["resource"]>;
  iconProps: Record<string, unknown>;
}) {
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
      {...(iconProps as object)}
      resource={{ ...resource, amount: 1, chance: undefined }}
      className="cc-icon"
    />
  );
}

/** Icon, figure, name: the three things a row says. */
function Words({ p, iconProps }: { p: CleanPortView; iconProps: Record<string, unknown> }) {
  const { port } = p;
  return (
    <>
      {port.kind === "power" ? (
        <span className="cc-bolt" />
      ) : port.resource ? (
        <PortIcon resource={port.resource} iconProps={iconProps as Record<string, unknown>} />
      ) : null}
      <span
        className="cc-num"
        data-unit={p.unit}
        data-zero={p.zero ? "" : undefined}
        data-gold={p.gold ? "" : undefined}
        data-small={p.numberSmall ? "" : undefined}
      >
        {p.number}
      </span>
      <span
        className="cc-pname"
        data-small={p.nameSmall || undefined}
        data-clip={p.nameClipped || undefined}
      >
        {p.name}
      </span>
    </>
  );
}

/**
 * The count under the machine (docs/up-to.md): what runs, big and white (`::before`, from `data-run`), and under it
 * what is set, as the overview's machine lines say it: the rule word, always (a click opens Any, Up to, Exactly), and
 * the set box (`::after`, from `data-set`): the number in gold, or "Set" with no count. A click anywhere else types a
 * count (Any becomes Up to), the wheel steps it, the middle button clears it (Any). Two elements: the block and the rule
 * word.
 */
export function CountBox({
  view,
  tip,
  ruleTip: ruleTipSpec,
  onSet,
  onStep,
  onRule,
  wasClick,
}: {
  view: CleanCardView["count"];
  tip: TipSpec;
  ruleTip?: TipSpec;
  onSet: (count: number | undefined) => void;
  onStep: (direction: -1 | 1) => void;
  onRule: (rule: PinRule) => void;
  wasClick: (event: MouseEvent) => boolean;
}) {
  const [draft, setDraft] = useState<string>();
  const [ruleMenu, setRuleMenu] = useState<MenuAnchor>();
  const [block, setBlock] = useState<HTMLDivElement | null>(null);
  // Escape closed the box: a blur that follows (a browser may send one as the box goes) sets nothing.
  const cancelled = useRef(false);
  const editing = draft !== undefined;
  // The open box sets what it holds as it goes: each wheel step at once, typing once it rests (`LIVE_TYPE_MS`), so the
  // plan follows without Enter. Read through refs: the wheel and the timer outlive the render that made them.
  const latest = useRef({ view, draft });
  latest.current = { view, draft };
  const opened = useRef<{ rule: PinRule; set?: number }>({ rule: view.rule });
  const changed = useRef(false);
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  // Sets `text` unless it is the card's count already. Typing never clears (an emptied box is a count being retyped);
  // the wheel below one and a box let go of empty do.
  const apply = (text: string, clear: boolean) => {
    const value = parseCountText(text);
    const now = latest.current.view;
    if (value === undefined || (!(value > 0) && (!clear || !now.pinned))) return;
    if (value > 0 && value === now.set) return;
    changed.current = true;
    onSet(value > 0 ? value : undefined);
  };
  // Let go of (a click anywhere else, Enter): what the box holds is set, if typing has not set it yet. Zero or nothing
  // clears it. A count that is already the card's sets nothing, so opening and leaving the box costs no undo step.
  const commit = () => {
    clearTimeout(typing.current);
    if (draft === undefined || cancelled.current) return;
    setDraft(undefined);
    apply(draft, true);
  };
  // Escape: the box closes and the card goes back to the count it had when the box opened.
  const cancel = () => {
    clearTimeout(typing.current);
    cancelled.current = true;
    setDraft(undefined);
    if (!changed.current) return;
    if (opened.current.rule === "any" && opened.current.set === undefined) onRule("any");
    else onSet(opened.current.set);
  };
  // The wheel steps the count, or the number in the box while it is open; the camera never gets it. Native and
  // non-passive so Ctrl+wheel does not zoom the page.
  useNativeWheel(block, (event) => {
    if (event.deltaY === 0 || checklistLocked() || !wheelChangesValues()) return;
    event.preventDefault();
    event.stopPropagation();
    const up = event.deltaY < 0;
    const open = latest.current.draft;
    if (open !== undefined) {
      sfxTick(up);
      clearTimeout(typing.current);
      const next = wheelDraft(open, latest.current.view, up ? 1 : -1);
      latest.current.draft = next;
      setDraft(next);
      apply(next, true);
      return;
    }
    // Each step ticks and claims the edit, so the board's change sound does not play on top.
    playEditSfx("ui.tick", 1, up ? 1.12 : 0.9);
    onStep(up ? 1 : -1);
  });
  return (
    <div
      ref={setBlock}
      role="button"
      tabIndex={0}
      className="cc-count nowheel"
      data-wheel-value=""
      aria-label={`${view.text} running, ${view.ruleWord.toLowerCase()}${view.pinned ? ` ${view.setText}` : ""}`}
      data-rule={view.rule}
      data-run={view.text}
      data-set={view.box}
      data-pinned={view.pinned ? "" : undefined}
      data-zero={view.zero ? "" : undefined}
      data-prompt={view.prompt ? "" : undefined}
      data-editing={editing ? "" : undefined}
      // The count sounds for itself: the page's click would miss the wheel and double the rule word's click.
      data-sfx-own=""
      {...tipAttrs(tip)}
      onClick={(event) => {
        glyph(event);
        if (!editing && wasClick(event) && !checklistLocked()) {
          sfxClick();
          cancelled.current = false;
          changed.current = false;
          opened.current = { rule: view.rule, set: view.set };
          setDraft(view.set !== undefined ? view.setText : "");
        }
      }}
      // The middle button clears the count: Any, the plan decides it again.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || editing || !view.pinned || checklistLocked()) return;
        event.stopPropagation();
        // The board's unpin sound, claimed so its change sound does not play it again.
        playEditSfx("board.unpin");
        onSet(undefined);
      }}
    >
      <div
        role={view.ruleFixed ? undefined : "button"}
        tabIndex={view.ruleFixed ? undefined : 0}
        className="cc-rule"
        data-fixed={view.ruleFixed ? "" : undefined}
        data-open={ruleMenu ? "" : undefined}
        data-menu-anchor=""
        aria-haspopup={view.ruleFixed ? undefined : "menu"}
        aria-expanded={view.ruleFixed ? undefined : ruleMenu !== undefined}
        {...(ruleTipSpec ? tipAttrs(ruleTipSpec) : {})}
        onClick={(event) => {
          glyph(event);
          if (view.ruleFixed || !wasClick(event) || checklistLocked()) return;
          sfxClick();
          setRuleMenu(ruleMenu ? undefined : anchorOf(event.currentTarget));
        }}
      >
        {view.ruleWord}
      </div>
      {editing ? (
        <input
          autoFocus
          value={draft}
          inputMode="decimal"
          aria-label="Machine count"
          size={1}
          className="nodrag"
          // As wide as the number it replaces, a few characters, growing with what is typed.
          style={{ width: `calc(${Math.max(3, draft.length + 1)}ch + 8px)` }}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            clearTimeout(typing.current);
            typing.current = setTimeout(() => apply(text, false), LIVE_TYPE_MS);
          }}
          onBlur={commit}
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") cancel();
            event.stopPropagation();
          }}
        />
      ) : null}
      {ruleMenu ? (
        <CountRuleMenu
          anchor={ruleMenu}
          rule={view.rule}
          onPick={onRule}
          onClose={() => setRuleMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

/**
 * The programmed circuit, a small badge in the well's top-left corner: the circuit's own icon, which already shows
 * its number, never dimmed. Its tip says "Circuit 24".
 */
export function CircuitBadge({
  nodeId,
  circuit,
}: {
  nodeId: string;
  circuit: NonNullable<CleanCardView["circuit"]>;
}) {
  const number = circuitNumber(circuit);
  if (!circuit.resource) return null;
  return (
    <span
      className="cc-circuit"
      {...tipAttrs({ id: `${nodeId}|circuit`, title: number ? `Circuit ${number}` : "Circuit" })}
    >
      {circuit.resource ? (
        <ResourceIcon
          itemZoom={1.5}
          resource={{ ...circuit.resource, amount: 1, chance: undefined }}
          bare
          tooltip={false}
          showAmount={false}
          showConsumedState={false}
          className="cc-circuit-icon"
        />
      ) : null}
    </span>
  );
}

/**
 * The bar along the foot (docs/up-to.md): one element. Its fill and a bottleneck's striped run-on are background
 * layers sized in px (`--fill`, `--ghost-l`, `--ghost-w`), the word is `::before` (`data-word`), the line is its text
 * and the fraction is `::after` (`data-frac`). Its tip has the details.
 */
export function CardFoot({
  nodeId,
  foot,
  gridRow,
}: {
  nodeId: string;
  foot: CleanFootView;
  gridRow?: number;
}) {
  return (
    <div
      className="cc-foot"
      data-tone={foot.tone}
      data-word={foot.word || undefined}
      data-frac={foot.frac || undefined}
      data-ghost={foot.ghost ? "" : undefined}
      {...tipAttrs(footTip(nodeId, foot))}
      style={
        {
          gridRow,
          "--fill": `${foot.fill}px`,
          ...(foot.ghost
            ? { "--ghost-l": `${foot.ghost.left}px`, "--ghost-w": `${foot.ghost.width}px` }
            : {}),
        } as CSSProperties
      }
    >
      {foot.say}
    </div>
  );
}

export function TierChip({
  label,
  tip,
  fixed,
  onStep,
  wasClick,
  extraData,
}: {
  label: string;
  tip: TipSpec;
  fixed?: boolean;
  onStep: (direction: -1 | 1) => void;
  wasClick: (event: MouseEvent) => boolean;
  extraData?: Record<string, string>;
}) {
  const colors = tierChipColors(label);
  const style = colors
    ? ({
        "--chip-bg": colors.background,
        "--chip-border": colors.border,
        "--chip-ink": colors.ink,
        "--chip-hover": colors.hover,
        "--chip-pressed": colors.pressed,
      } as CSSProperties)
    : undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      className="cc-chip nowheel"
      data-wheel-value=""
      style={style}
      {...tipAttrs(tip)}
      aria-label={`Tier ${label}`}
      data-hatch-menu-anchor=""
      data-fixed={fixed ? "" : undefined}
      data-underline={colors?.underline ? "" : undefined}
      {...extraData}
      onClick={(event) => {
        glyph(event);
        if (!fixed && wasClick(event)) onStep(1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        glyph(event);
        if (!fixed) onStep(-1);
      }}
      onWheel={(event) => {
        if (checklistLocked() || !wheelChangesValues()) return;
        event.stopPropagation();
        if (!fixed) onStep(event.deltaY < 0 ? 1 : -1);
      }}
    >
      {label}
    </div>
  );
}

export function AmpsChip({
  amps,
  tier,
  tip,
  onSet,
  wasClick,
}: {
  amps: NonNullable<CleanCardView["amps"]>;
  tier?: string;
  tip: TipSpec;
  onSet: (value: number) => void;
  wasClick: (event: MouseEvent) => boolean;
}) {
  const [draft, setDraft] = useState<string>();
  // The chip's width as the box opens: the box fills exactly that, so typing never widens the head.
  const [openWidth, setOpenWidth] = useState<number>();
  const colors = tier ? tierChipColors(tier) : undefined;
  const style = colors
    ? ({
        "--chip-bg": colors.background,
        "--chip-border": colors.border,
        "--chip-ink": colors.ink,
        "--chip-hover": colors.hover,
        "--chip-pressed": colors.pressed,
      } as CSSProperties)
    : undefined;
  const commit = () => {
    if (draft === undefined) return;
    const value = Number.parseFloat(draft);
    setDraft(undefined);
    if (Number.isFinite(value) && value >= 1) onSet(value);
  };
  const step = (event: WheelEvent) => {
    if (checklistLocked() || !wheelChangesValues()) return;
    event.stopPropagation();
    const unit = event.ctrlKey && event.shiftKey ? 1000 : event.ctrlKey ? 10 : 1;
    if (event.shiftKey && !event.ctrlKey) {
      onSet(event.deltaY < 0 ? amps.value * 4 : Math.max(1, Math.floor(amps.value / 4)));
      return;
    }
    onSet(Math.max(1, amps.value + (event.deltaY < 0 ? unit : -unit)));
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className="cc-chip nowheel"
      data-wheel-value=""
      data-editing={draft !== undefined ? "" : undefined}
      style={{
        ...style,
        minWidth: 48,
        width: draft !== undefined && openWidth ? openWidth : "max-content",
      }}
      {...tipAttrs(tip)}
      onClick={(event) => {
        glyph(event);
        if (draft === undefined && wasClick(event)) {
          setOpenWidth(event.currentTarget.offsetWidth || undefined);
          setDraft(String(amps.value));
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        glyph(event);
        onSet(Math.max(1, amps.value - 1));
      }}
      onWheel={step}
    >
      {draft === undefined ? (
        amps.label
      ) : (
        <input
          autoFocus
          value={draft}
          inputMode="numeric"
          aria-label="Amps"
          size={1}
          className="nodrag"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(undefined);
            event.stopPropagation();
          }}
        />
      )}
    </div>
  );
}

export function StripChip({
  chip,
  nodeId,
  control,
  needK,
  onStep,
  onOpen,
  wasClick,
}: {
  chip: CleanChipView;
  nodeId: string;
  control?: SettingControl;
  needK?: number;
  onStep: (id: string, direction: -1 | 1) => void;
  /** The chip's list (Filter box, icons), under the chip. */
  onOpen: (id: string, anchor: MenuAnchor) => void;
  wasClick: (event: MouseEvent) => boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="cc-sc nowheel"
      data-wheel-value=""
      data-label={chip.label}
      data-warn={chip.warn ? "" : undefined}
      data-reading={chip.reading ? "" : undefined}
      data-menu-anchor=""
      {...tipAttrs(stripTip(nodeId, chip, control, needK))}
      style={{
        left: chip.x,
        top: chip.y,
        width: chip.width,
        ...(chip.icon ? { backgroundImage: `url(${chip.icon})`, paddingLeft: 22 } : undefined),
      }}
      onClick={(event) => {
        glyph(event);
        if (!chip.reading && wasClick(event)) {
          if (control && control.options.length > 1) onOpen(chip.id, anchorOf(event.currentTarget));
          else onStep(chip.id, 1);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        glyph(event);
        if (!chip.reading) onStep(chip.id, -1);
      }}
      onWheel={(event) => {
        if (chip.reading || checklistLocked() || !wheelChangesValues()) return;
        event.stopPropagation();
        onStep(chip.id, event.deltaY < 0 ? 1 : -1);
      }}
    >
      {chip.value}
    </div>
  );
}

export interface CleanCardProps {
  view: CleanCardView;
  actions: CleanCardActions;
  context: CleanCardContext;
  /** The raw recipe and node, for the machine list and the card menu. */
  recipe: Recipe;
  node: FactoryNode;
}

/** The clean recipe card: header, hairline, port rails around the picture, power row, settings strip. */
export function CleanCard({ view, actions, context, recipe, node }: CleanCardProps) {
  const { wasClick, onPointerDownCapture } = useClickSlop();
  const { zoomedOutNames: glanceNames, problemOutlines } = useDeviceSettings();
  const glance = glanceFace(view.glanceArt ? `url(${view.glanceArt})` : undefined, view.glance);
  // A task board somewhere on this device is about this card: the most pressing one's colour, a dot before the name.
  const taskStatus = useCardTaskStatus(view.nodeId);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => ensureInteractionHost(), []);
  // Every prompt on the board shares one phase however late it mounted.
  useEffect(() => {
    // A ring's outline pulses off the same clock as the prompts.
    if (!view.unset && !view.loop) return;
    // Queued: getAnimations flushes the page's style, once a frame for every card mounted in it.
    syncPromptPhase();
  }, [view.unset, view.loop]);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const duplicateNode = useFactoryStore((state) => state.duplicateNode);
  const [listOpen, setListOpen] = useState(false);
  const [listAnchor, setListAnchor] = useState<MenuAnchor>();
  const [sheetAnchor, setSheetAnchor] = useState<MenuAnchor>();
  const [chipList, setChipList] = useState<{ id: string; anchor: MenuAnchor }>();
  const updateNode = useFactoryStore((state) => state.updateNode);
  const tipFacts = useCardTipFacts(recipe, node);
  const controls = useMemo(() => settingControls(recipe, node), [recipe, node]);
  const heatNeed = useMemo(() => recipeHeatNeed(recipe, node), [recipe, node]);
  const stepChip = (id: string, direction: -1 | 1) => {
    const control = controls.find((entry) => entry.id === id);
    const next = control ? steppedOption(control, direction) : undefined;
    if (control && next) updateNode(node.id, settingPatch(recipe, node, control.id, next.key));
  };
  const openSheet = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!wasClick(event)) return;
    if (sheetAnchor) {
      setSheetAnchor(undefined);
      return;
    }
    const gear = anchorOf(event.currentTarget);
    const head = event.currentTarget.closest(".cc-head");
    setSheetAnchor({
      left: gear.left,
      top: gear.top,
      bottom: head ? head.getBoundingClientRect().bottom : gear.bottom,
    });
  };
  const [menu, setMenu] = useState<{
    kind: "actions" | "settings";
    x: number;
    top: number;
    bottom: number;
    hangsFrom?: Element;
  }>();

  const openMenu = (kind: "actions" | "settings") => (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!wasClick(event)) return;
    const card = event.currentTarget.closest("[data-node-glance-root]") ?? undefined;
    // The menu hangs under the key, as the mod's (RecipeCard.openActions).
    const r = event.currentTarget.getBoundingClientRect();
    setMenu(
      menu?.kind === kind
        ? undefined
        : { kind, x: r.left, top: r.top, bottom: r.bottom, hangsFrom: card },
    );
  };

  return (
    <div
      ref={rootRef}
      className="cc-card"
      data-node-glance-root=""
      data-selected={view.selected ? "" : undefined}
      data-cannot-run={view.cannotRun ? "" : undefined}
      data-unset={view.unset ? "" : undefined}
      data-tone={problemOutlines ? frameTone(view.foot) : undefined}
      data-loop={view.loop}
      onPointerDownCapture={onPointerDownCapture}
    >
      <div className="cc-head">
        <div
          role="button"
          tabIndex={0}
          className="cc-key"
          data-glyph="menu"
          data-hatch-menu-anchor=""
          aria-label="Card actions"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "actions"}
          {...tipAttrs(menuTip(view.nodeId))}
          onClick={openMenu("actions")}
        />
        <div
          role="button"
          tabIndex={0}
          className="cc-key"
          data-glyph="gear"
          data-hatch-menu-anchor=""
          data-warn={undefined}
          aria-label="Machine settings"
          aria-haspopup="menu"
          data-menu-anchor=""
          aria-expanded={sheetAnchor !== undefined}
          {...tipAttrs(
            gearTip(
              view.nodeId,
              controls.some((entry) => entry.warn),
            ),
          )}
          onClick={openSheet}
        />
        <div
          role={view.hasPicker ? "button" : undefined}
          tabIndex={view.hasPicker ? 0 : undefined}
          className={view.hasPicker ? "cc-name nowheel" : "cc-name"}
          style={
            {
              "--cc-name-size": `${view.nameSize}px`,
              ...(taskStatus ? { "--cc-task": TASK_STATUS_COLOR[taskStatus] } : {}),
            } as CSSProperties
          }
          data-task={taskStatus}
          data-picker={view.hasPicker ? "" : undefined}
          data-open={listOpen ? "" : undefined}
          data-machine-menu-toggle={view.hasPicker ? "" : undefined}
          data-wheel-steps={view.hasPicker ? "" : undefined}
          data-wheel-value={view.hasPicker ? "" : undefined}
          data-menu-anchor=""
          {...tipAttrs(machineNameTip(view, tipFacts))}
          onClick={
            view.hasPicker
              ? (event) => {
                  glyph(event);
                  if (!wasClick(event)) return;
                  const name = anchorOf(event.currentTarget);
                  const head = event.currentTarget.closest(".cc-head");
                  setListAnchor({
                    left: name.left,
                    top: name.top,
                    bottom: head ? head.getBoundingClientRect().bottom : name.bottom,
                  });
                  setListOpen((open) => !open);
                }
              : undefined
          }
          onWheel={
            view.hasPicker
              ? (event) => {
                  if (checklistLocked() || !wheelChangesValues()) return;
                  event.stopPropagation();
                  actions.cycleMachine(event.deltaY < 0 ? -1 : 1);
                }
              : undefined
          }
        >
          {view.name}
          {listOpen && listAnchor ? (
            <MachineListMenu
              anchor={listAnchor}
              handlers={context.machineHandlers}
              selectedId={context.selectedMachineHandler.id}
              recipeMap={recipe.source?.recipeMap ?? recipe.machineType}
              onUse={(id) => {
                actions.switchMachine(id);
                setListOpen(false);
              }}
              onClose={() => setListOpen(false)}
            />
          ) : null}
        </div>
        {view.amps ? (
          <AmpsChip
            amps={view.amps}
            tier={view.tier?.label}
            tip={powerPanelTip(view, "amps")}
            onSet={actions.setAmps}
            wasClick={wasClick}
          />
        ) : null}
        {view.tier ? (
          <TierChip
            label={view.tier.label}
            tip={view.amps ? powerPanelTip(view, "tier") : tierChipTip(view, tipFacts)}
            fixed={view.tier.fixed}
            onStep={actions.stepTier}
            wasClick={wasClick}
          />
        ) : null}
      </div>

      <div className="cc-rail" data-side="input">
        {view.inputs.map((p) => (
          <CleanPortRow key={p.key} p={p} wasClick={wasClick} unset={view.unset} />
        ))}
        {view.power ? (
          <div
            className="cc-row"
            data-power=""
            data-side="input"
            data-stalled={view.power.stalled ? "" : undefined}
            {...tipAttrs(view.amps ? powerPanelTip(view, "power") : powerRowTip(view, tipFacts))}
          >
            <span className="cc-bolt" />
            <span className="cc-num" data-unit={view.power.unit}>
              {view.power.number}
            </span>
            <span className="cc-pname">{view.power.name}</span>
          </div>
        ) : null}
      </div>

      <div className="cc-pic">
        {view.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="cc-art" src={view.art} alt="" draggable={false} />
        ) : context.machineIcon?.iconPath || context.machineIcon?.iconAtlas ? (
          <ResourceIcon
            resource={{
              kind: "item",
              id: context.machineIcon.id,
              amount: 1,
              displayName: context.machineIcon.displayName ?? context.machineIcon.id,
              iconPath: context.machineIcon.iconPath,
              iconAtlas: context.machineIcon.iconAtlas,
              dominantColor: context.machineIcon.dominantColor,
            }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            iconPixelSize={109}
            className="cc-machine"
          />
        ) : null}
        {view.circuit ? <CircuitBadge nodeId={view.nodeId} circuit={view.circuit} /> : null}
        <CountBox
          view={view.count}
          tip={countRowsTip(view, tipFacts.shared)}
          ruleTip={ruleTip(view)}
          onSet={actions.setCount}
          onStep={actions.stepCount}
          onRule={actions.setRule}
          wasClick={wasClick}
        />
      </div>

      <div className="cc-rail" data-side="output">
        {view.outputs.map((p) => (
          <CleanPortRow key={p.key} p={p} wasClick={wasClick} unset={view.unset} />
        ))}
      </div>

      {view.chips.length > 0 ? (
        <div className="cc-strip" style={{ height: view.stripHeight }}>
          {view.chips.map((chip) => (
            <StripChip
              key={chip.id}
              chip={chip}
              nodeId={view.nodeId}
              control={controls.find((entry) => entry.id === chip.id)}
              needK={heatNeed}
              onStep={stepChip}
              onOpen={(id, anchor) => setChipList({ id, anchor })}
              wasClick={wasClick}
            />
          ))}
        </div>
      ) : null}

      {view.foot ? <CardFoot nodeId={view.nodeId} foot={view.foot} /> : null}

      <div
        className="cc-glance"
        data-node-detail="glance"
        data-count={view.count.text}
        data-name={glanceNames ? view.name : undefined}
        data-bar={glance["data-bar"]}
        data-tone={glance["data-tone"]}
        aria-hidden
        style={glance.style}
      >
        {glance.text}
      </div>

      {sheetAnchor ? (
        <SettingsSheet
          nodeId={node.id}
          anchor={sheetAnchor}
          onClose={() => setSheetAnchor(undefined)}
        />
      ) : null}
      {chipList && controls.find((entry) => entry.id === chipList.id) ? (
        <OptionListMenu
          anchor={chipList.anchor}
          control={controls.find((entry) => entry.id === chipList.id)!}
          onPick={(key) => {
            updateNode(node.id, settingPatch(recipe, node, chipList.id, key));
            setChipList(undefined);
          }}
          onClose={() => setChipList(undefined)}
        />
      ) : null}
      {menu?.kind === "actions" ? (
        <CardActionsMenu
          anchor={{ left: menu.x, top: menu.top, bottom: menu.bottom }}
          nodeId={node.id}
          onClose={() => setMenu(undefined)}
          onClone={() => cloneWithSound(duplicateNode, node.id)}
          onDelete={() => deleteNode(node.id)}
          onAddToTask={
            TASKS_ENABLED
              ? () =>
                  void openAddToTask(cardsForTask(node.id), {
                    left: menu.x,
                    top: menu.top,
                    bottom: menu.bottom,
                  })
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
