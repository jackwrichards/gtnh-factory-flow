"use client";

import "./rail.css";
import { fluidSwatchStyle } from "../fluid-swatch";
import { wheelChangesValues } from "@/lib/device-settings";
import { OVERVIEW_DEFAULT_WIDTH, PANEL_RAIL_WIDTH } from "@/lib/workspace-columns";

import { Zap } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { machineArtPixels } from "../../MachinePicker";
import { FoldGlyph } from "../fold/FoldKey";
import { BoardMenu, MenuRow } from "../menus/BoardMenu";
import { useMachineHandlerIcons } from "../../machine-icons";
import { getFallbackFluidColor, ResourceIcon } from "@/components/nei/ResourceIcon";
import { formatCompact } from "@/lib/model/resources";
import {
  powerDisplayFromEuT,
  powerDisplaySuffix,
  rateMultiplierForKind,
  rateSuffixForKind,
  rateUnitSuffix,
} from "@/lib/model/rate-unit";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { formatAmountWithSuffix, RULE_MARK, RULE_NAME, RULE_STEPS } from "../../rate-rule";
import { AmpsChip, TierChip } from "../CleanCard";
import { useCleanCardModel, wheelDraft } from "../clean-model";
import { powerPanelTip } from "../interaction/tips";
import type { RecipeNodeData } from "../../RecipeNode";
import { CC, tierChipColors } from "../tokens";
import { UP_TO_COLOR, UP_TO_WORD, shownReason, upToSentence } from "../up-to-reason";
import { PIN_RULE_LABEL } from "@/lib/model/pin-rule";
import {
  pinCount,
  pinSnapshot,
  restorePin,
  type PinSnapshot,
  setDrawerRate,
  setDrawerRule,
  setLineRate,
  setPortRate,
  showSetupsMaking,
  stepDrawerRule,
  stepPinRule,
  walkCards,
  walkResource,
  frameCards,
} from "./rail-actions";
import { RailKey, RateBox, RuleKey, wheelHandlerFor } from "./rail-controls";
import {
  lineHeight,
  layoutRail,
  ROW_H,
  SETTER_H,
  visibleSlice,
  type Placed,
  type Setter,
} from "./rail-layout";
import { steppedRate } from "./rail-math";
import { measureClean, useFontEpoch } from "../text-measure";
import { useRailData } from "./rail-data";
import type { RailDrawer, RailLine, RailMachine, RailPin } from "./rail-model";
import { hideTip, tipProps, type TipContent } from "./rail-tip";
import { toggleRailSection, useRailView, writeRailView } from "./rail-view";
import { SpareBlock } from "./SpareBlock";
import { openAddToTask } from "@/components/tasks/AddToTask";
import { cardsForTask } from "@/lib/tasks/make-task";
import { isLiveConfigured } from "@/lib/live/live-config";

/** Task boards come with live plans: no Add to a task without them. */
const TASKS_ENABLED = isLiveConfigured();

/**
 * The overview, as a column left of the board: the mod's `OverviewRail`
 * (UI spec section 8). Sections INPUTS, OUTPUTS, INTERNAL and MACHINES, a
 * resource per row with the drawers and ports that set it as a rule key and a
 * rate box, "~ Set" lines for what nothing sets, spare blocks with a bar per
 * place, and the machines grouped with their tier, draw and count. Folds to a
 * strip (kept per device). Hovering a row lights its resource on the board.
 */

/** The rail's width unless the player drags its edge (a plan board's workspace, `fitPanels`). */
export const RAIL_WIDTH = OVERVIEW_DEFAULT_WIDTH;
export const RAIL_FOLDED_WIDTH = PANEL_RAIL_WIDTH;
/** The rail's type: Monocraft at 13 px (the mod's 8 px at the rail's 336 against its 198: its size on screen). */
export const RAIL_FONT = 13;
/** A rule key, a gap and a rate box: the controls' block at a line's right (the mod's 12 + 2 + 38 of its 198). */
export const CONTROLS_W = 88;
/** A machine line's room is the rail's width less its left indent (30) and the right padding (8). */
const MACHINE_INDENT = 30 + 8;
/** The rail's width as it is now (shell px), for the lines that fit their text to it. */
const RailWidthContext = createContext(RAIL_WIDTH);

const INK: Record<string, string> = {
  INPUTS: CC.source,
  OUTPUTS: CC.product,
  INTERNAL: "#D4D4D4",
  MACHINES: CC.ink,
};
const SIGN: Record<"inputs" | "outputs" | "internal", string> = {
  inputs: "-",
  outputs: "+",
  internal: "",
};

/** "×" count text, the mod's `Fmt.machines`. */
export function machinesText(count: number): string {
  if (count <= 0) return "0";
  if (count < 0.001) return "<0.001";
  if (count >= 100) return String(Math.ceil(count - 1e-9));
  const decimals = count < 1 ? 3 : count < 10 ? 2 : 1;
  return String(Number(count.toFixed(decimals)));
}

const powerIcons = new Map<string, unknown>();
function powerIcon(sourceId: string) {
  if (!powerIcons.has(sourceId)) {
    const icon = getPowerMachineIcon(sourceId);
    powerIcons.set(
      sourceId,
      icon
        ? {
            kind: "item",
            id: icon.id,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            dominantColor: icon.dominantColor,
          }
        : undefined,
    );
  }
  return powerIcons.get(sourceId) as Parameters<typeof ResourceIcon>[0]["resource"];
}

export function ResourceGlyph({ line }: { line: Pick<RailLine, "resource" | "energy"> }) {
  if (line.energy) {
    return (
      <span className="rail-icon" style={{ background: "#7a5a12" }}>
        <Zap aria-hidden size={12} style={{ margin: 2 }} color="#fcd34d" fill="#fcd34d" />
      </span>
    );
  }
  if (line.resource.kind === "fluid") {
    // The mod's square of the fluid's texture, as on the cards and drawers.
    const resource = line.resource;
    const color =
      resource.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      getFallbackFluidColor(resource.id);
    return (
      <span
        className="rail-icon rail-swatch"
        role="img"
        aria-label={resource.displayName}
        style={fluidSwatchStyle({ ...resource, dominantColor: color })}
      />
    );
  }
  return (
    <span className="rail-icon">
      <ResourceIcon
        resource={{ ...line.resource, amount: 1 }}
        size="sm"
        showAmount={false}
        bare
        tooltip={false}
        className="rail-icon-art"
      />
    </span>
  );
}

interface RailState {
  editing: string | null;
  edit: (key: string | null) => void;
  wheeled: Record<string, number>;
  wheelEdit: (key: string, value: number, commit: (value: number) => void) => void;
  menu: (drawer: RailDrawer, x: number, y: number) => void;
}

/**
 * The whole rail. `open` is whether it shows: the player's fold, and the window's on top of it (a plan board's
 * workspace); a click on the strip opens it as the player's choice and tells `onOpen` (a window that folded it keeps it
 * open then).
 */
export function OverviewRail({
  forceOpen = false,
  side = "left",
  open,
  onOpen,
}: { forceOpen?: boolean; side?: "left" | "right"; open?: boolean; onOpen?: () => void } = {}) {
  const view = useRailView();
  if (!(open ?? view.open) && !forceOpen) return <FoldedStrip side={side} onOpen={onOpen} />;
  // A phone's drawer keeps the lines as they were; a column follows the width the player gave it.
  return <OpenRail side={side} fitWidth={!forceOpen} />;
}

function FoldedStrip({ side, onOpen }: { side: "left" | "right"; onOpen?: () => void }) {
  return (
    <ColumnStrip
      label="OVERVIEW"
      open="Open the overview"
      side={side}
      helpAnchor="overview-rail"
      onOpen={() => {
        writeRailView({ open: true });
        onOpen?.();
      }}
    />
  );
}

/**
 * A folded column: the whole strip one key, the arrow at its top pointing the way the column opens, the name running
 * down it. The overview's and the items column's are this one strip, so they cannot differ.
 */
export function ColumnStrip({
  label,
  open,
  side,
  helpAnchor,
  onOpen,
}: {
  label: string;
  /** What a click does, for the tooltip and screen readers. */
  open: string;
  /** The side of the board the column folds to. */
  side: "left" | "right";
  helpAnchor?: string;
  onOpen: () => void;
}) {
  return (
    <div
      className="rail-strip"
      role="button"
      tabIndex={0}
      aria-label={open}
      data-side={side}
      data-help-anchor={helpAnchor}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      {...tipProps(`rail|open|${label}`, () => ({ title: open }))}
    >
      <FoldGlyph direction={side === "left" ? "right" : "left"} />
      <span className="rail-strip-label">{label}</span>
    </div>
  );
}

function OpenRail({ side, fitWidth }: { side: "left" | "right"; fitWidth: boolean }) {
  useRateDisplayUnits();
  const view = useRailView();
  const { rail, spares } = useRailData();
  const workspace = useWorkspaceView();
  const peak = !workspace.averageMachineDraw;
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ drawer: RailDrawer; x: number; y: number } | null>(null);
  const [wheeled, setWheeled] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The rail's width, to the 8 px below it: the lines fit their text to it, and a drag should not redo every line.
  const [width, setWidth] = useState(RAIL_WIDTH);
  useLayoutEffect(() => {
    const el = root.current;
    if (!fitWidth || !el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.floor(el.clientWidth / 8) * 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWidth]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const listWheelAt = useRef(0);
  const anchorKey = useRef<string | null>(null);
  const anchorTop = useRef<number | undefined>(undefined);

  const folded = useMemo(() => new Set(view.folded), [view.folded]);
  const layout = useMemo(
    () => layoutRail({ rail, spares, filter, folded, peak }),
    [rail, spares, filter, folded, peak],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  // The list's size and place, for drawing only what is in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const measure = () => {
      // A hidden or not-yet-laid-out list reads 0: keep the last size then.
      if (el.clientHeight > 0) setViewport(el.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A control under the pointer takes the wheel unless the list was scrolled by the wheel within the last 400 ms,
  // so scrolling past a box never steps it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      const now = Date.now();
      const handler =
        now - listWheelAt.current > 400 && wheelChangesValues()
          ? wheelHandlerFor(event.target)
          : undefined;
      if (handler) {
        event.preventDefault();
        handler(event.deltaY < 0 ? 1 : -1, event.ctrlKey, event.shiftKey);
        return;
      }
      listWheelAt.current = now;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The spare slider under the pointer (or in hand) stays where it is on screen while lines above it come and go.
  useLayoutEffect(() => {
    const el = scroller.current;
    const key = anchorKey.current;
    if (!el || !key) {
      anchorTop.current = undefined;
      return;
    }
    const at = layout.placed.find((p) => p.key === `p:${key}`)?.top;
    if (at === undefined) {
      anchorTop.current = undefined;
      return;
    }
    if (anchorTop.current !== undefined && at !== anchorTop.current)
      el.scrollTop += at - anchorTop.current;
    anchorTop.current = at;
  }, [layout]);

  const edit = useCallback((key: string | null) => {
    hideTip();
    setEditing(key);
  }, []);
  const wheelEdit = useCallback((key: string, value: number, commit: (value: number) => void) => {
    setWheeled((w) => ({ ...w, [key]: value }));
    const was = timers.current.get(key);
    if (was !== undefined) clearTimeout(was);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        commit(value);
        setWheeled((w) => {
          const rest = { ...w };
          delete rest[key];
          return rest;
        });
      }, 350),
    );
  }, []);
  const state: RailState = useMemo(
    () => ({
      editing,
      edit,
      wheeled,
      wheelEdit,
      menu: (drawer, x, y) => setMenu({ drawer, x, y }),
    }),
    [editing, edit, wheeled, wheelEdit],
  );

  const visible = visibleSlice(layout.placed, scrollTop - 200, scrollTop + viewport + 200);
  const euText = `${formatCompact(powerDisplayFromEuT(peak ? rail.power.peak.used : rail.power.average.used))} ${powerDisplaySuffix()}`;

  return (
    <RailWidthContext.Provider value={width}>
    <div
      ref={root}
      className="rail-root"
      data-side={side}
      data-help-anchor="overview-rail"
      onPointerDownCapture={(event) => {
        // A press anywhere on the rail sets what was being typed.
        if (editing && !(event.target instanceof HTMLInputElement)) {
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
      }}
    >
      <div className="rail-head">
        <span className="rail-head-title">OVERVIEW</span>
        <RailKey
          label="Fold the overview"
          className="rail-key-fold"
          onClick={() => writeRailView({ open: false })}
          tip={() => ({ title: "Fold the overview" })}
        >
          <FoldGlyph direction={side} />
        </RailKey>
      </div>
      <input
        className="rail-filter"
        placeholder="Filter resources..."
        value={filter}
        spellCheck={false}
        onChange={(event) => setFilter(event.target.value)}
        aria-label="Filter resources"
      />
      <div
        ref={scroller}
        className="rail-list"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onPointerLeave={() => {
          anchorKey.current = null;
        }}
      >
        <div className="rail-canvas" style={{ height: layout.height }}>
          {visible.map((placed) => (
            <div
              key={placed.key}
              className="rail-item"
              style={{ top: placed.top, height: placed.height }}
              onPointerEnter={() => {
                anchorKey.current = placed.item.t === "spare" ? placed.item.spare.key : null;
                if (placed.item.t === "spare") anchorTop.current = placed.top;
              }}
            >
              <ItemView placed={placed} state={state} euText={euText} peak={peak} />
            </div>
          ))}
        </div>
      </div>
      {menu ? (
        <RuleMenu drawer={menu.drawer} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      ) : null}
    </div>
    </RailWidthContext.Provider>
  );
}

const ItemView = memo(function ItemView({
  placed,
  state,
  euText,
  peak,
}: {
  placed: Placed;
  state: RailState;
  euText: string;
  peak: boolean;
}) {
  const { item } = placed;
  switch (item.t) {
    case "section":
      return <SectionBar item={item} euText={euText} peak={peak} />;
    case "empty":
      return <div className="rail-empty">{item.text}</div>;
    case "line":
      return <LineRow item={item} state={state} />;
    case "spare":
      return <SpareBlock spare={item.spare} />;
    case "power":
      return (
        <div className="rail-power" style={{ height: placed.height }}>
          <span style={{ color: CC.muted }}>{item.label}</span>
          <b
            style={{
              color: item.label === "Made" ? "#FCD34D" : item.value >= 0 ? CC.ok : CC.red,
            }}
          >
            {item.label === "Net" ? (item.value >= 0 ? "+" : "-") : ""}
            {formatCompact(powerDisplayFromEuT(Math.abs(item.value)))} {powerDisplaySuffix()}
          </b>
        </div>
      );
    case "group":
      return <GroupRow name={item.name} entries={item.entries} />;
    case "machine":
      return <MachineRow entry={item.entry} peak={peak} state={state} />;
    case "gap":
      return null;
  }
});

function SectionBar({
  item,
  euText,
  peak,
}: {
  item: Extract<Placed["item"], { t: "section" }>;
  euText: string;
  peak: boolean;
}) {
  const shown = item.shown !== item.count;
  const filtering = shown;
  return (
    <div
      className="rail-sec"
      style={{ "--ink": INK[item.id] } as CSSProperties}
      data-folded={item.folded ? "" : undefined}
      role="button"
      tabIndex={0}
      aria-expanded={!item.folded}
      onClick={() => toggleRailSection(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") toggleRailSection(item.id);
      }}
      {...tipProps(`sec|${item.id}`, () => ({
        title: item.id,
        actions: [{ input: "left", label: "Fold or unfold" }],
      }))}
    >
      <span className="rail-sec-tri" />
      <span className="rail-sec-title" style={{ color: INK[item.id] }}>
        {item.id}
      </span>
      <span className="rail-sec-badge">
        {filtering ? `${item.shown} / ${item.count}` : item.count}
      </span>
      <span className="rail-sec-end">
        {item.id === "MACHINES" ? (
          <>
            <span>{euText}</span>
            <RailKey
              label={peak ? "Peak power" : "Average power"}
              onClick={() => writeWorkspaceView({ averageMachineDraw: peak })}
              onContext={() => writeWorkspaceView({ averageMachineDraw: peak })}
              tip={() => ({
                title: peak ? "Peak power" : "Average power",
                notes: [
                  {
                    text: peak
                      ? "Every machine running at once."
                      : "Machines running only as much as the plan needs.",
                    tone: "muted",
                  },
                ],
                actions: [{ input: "left", label: peak ? "Show the average" : "Show the peak" }],
              })}
            >
              {peak ? "Peak" : "Avg"}
            </RailKey>
          </>
        ) : item.id === "INTERNAL" ? null : (
          rateUnitSuffix(false)
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource lines
// ---------------------------------------------------------------------------

function lineTip(line: RailLine, text: string): TipContent {
  return {
    title: line.label,
    sub: text,
    actions: [
      { input: "left", label: "Go to the cards that make or use it, one by one" },
      { input: "right", label: "Find public plans that make it" },
    ],
  };
}

const LineRow = memo(function LineRow({
  item,
  state,
}: {
  item: Extract<Placed["item"], { t: "line" }>;
  state: RailState;
}) {
  const { line, section, amount, setters } = item;
  const [hot, setHot] = useState(false);
  const setHovered = useFactoryStore((s) => s.setHoveredFlowResourceKey);
  const ink = INK[section.toUpperCase()] ?? CC.ink;
  const mult = rateMultiplierForKind(line.kind);
  const shown = amount * mult;
  const number = `${amount > 0 ? SIGN[section] : ""}${formatCompact(shown)}`;
  const unitText = line.energy ? rateSuffixForKind(line.kind).trim() : "";
  const sources = section === "inputs";
  const openLine =
    section !== "internal" && setters.length === 0 && !line.energy && line.open.length > 0;
  const tint = `${ink}0D`;
  const rowHeight = lineHeight(setters.length);

  const enter = () => {
    setHot(true);
    setHovered(line.key);
  };
  const leave = () => {
    setHot(false);
    setHovered(undefined);
  };

  return (
    <div
      className="rail-line"
      style={{ height: rowHeight, "--tint": tint, "--ink": ink } as CSSProperties}
      data-hot={hot ? "" : undefined}
      data-resource-row={line.key}
      onClick={() => walkResource(line.key)}
      onAuxClick={(event: MouseEvent) => {
        if (event.button === 1) walkResource(line.key);
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        showSetupsMaking(line);
      }}
      {...tipProps(
        `row|${section}|${line.key}`,
        () =>
          lineTip(
            line,
            `${number}${unitText ? ` ${unitText}` : ` ${rateSuffixForKind(line.kind).trim()}`}`,
          ),
        { enter, leave },
      )}
    >
      <div className="rail-row" style={{ top: 0, height: ROW_H }}>
        <ResourceGlyph line={line} />
        <span className="rail-name">{line.label}</span>
        <span className="rail-num" data-zero={amount > 0 ? undefined : ""}>
          {number}
          {unitText ? <i>{unitText}</i> : null}
        </span>
        <div className="rail-controls">
          {setters.length > 0 ? (
            <SetterControls setter={setters[0]!} line={line} state={state} />
          ) : openLine ? (
            <OpenLineControls line={line} sources={sources} state={state} />
          ) : null}
        </div>
      </div>
      {setters.slice(1).map((setter, i) => {
        const top = ROW_H + i * SETTER_H;
        return (
          <div key={setterKey(setter)}>
            <span
              className="rail-setter-branch"
              style={{ top: top - 8, height: SETTER_H / 2 + 8 }}
            />
            <span className="rail-setter-elbow" style={{ top: top + SETTER_H / 2 }} />
            <div className="rail-row" style={{ top, height: SETTER_H, paddingLeft: 24 }}>
              <span className="rail-name" />
              <div className="rail-controls">
                <SetterControls setter={setter} line={line} state={state} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

function setterKey(setter: Setter): string {
  return setter.type === "drawer"
    ? `drawer:${setter.id}`
    : `port:${setter.nodeId}:${setter.handle}`;
}

function SetterControls({
  setter,
  line,
  state,
}: {
  setter: Setter;
  line: RailLine;
  state: RailState;
}) {
  return setter.type === "drawer" ? (
    <DrawerControls drawer={setter} line={line} state={state} />
  ) : (
    <PortControls pin={setter} line={line} state={state} />
  );
}

function DrawerControls({
  drawer,
  line,
  state,
}: {
  drawer: RailDrawer;
  line: RailLine;
  state: RailState;
}) {
  const mult = rateMultiplierForKind(line.kind);
  const key = `drawer:${drawer.id}`;
  const wheeled = state.wheeled[key];
  const perSecond = wheeled ?? drawer.ratePerSecond;
  const set = wheeled !== undefined ? wheeled > 0 : drawer.set;
  const shown = perSecond * mult;
  const mark = RULE_MARK[drawer.rule];
  return (
    <>
      <RuleKey
        mark={mark}
        tone={drawer.rule === "ignore" ? "muted" : "gold"}
        label={`Rule of the ${line.label} drawer`}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          state.menu(drawer, rect.left, rect.bottom + 2);
        }}
        onContext={(event) => {
          event.stopPropagation();
          stepDrawerRule(drawer, -1);
        }}
        onMiddle={(event) => {
          event.stopPropagation();
          setDrawerRule(drawer, "ignore");
        }}
        onWheel={(direction) => stepDrawerRule(drawer, direction)}
        tip={() => ({
          title: "Rule",
          sub: RULE_NAME[drawer.rule],
          notes: [{ text: ruleMeaning(drawer), tone: "muted" }],
          actions: [
            { input: "left", label: "Pick" },
            { input: "right", label: "Previous" },
            { input: "wheel", label: "Next or previous" },
            { input: "middle", label: "Clear" },
          ],
        })}
      />
      <RateBox
        label={`Rate of the ${line.label} drawer`}
        text={formatCompact(shown)}
        gold={set}
        unmet={drawer.unmet}
        editing={state.editing === key}
        initial={set ? formatAmountWithSuffix(shown) : ""}
        onStartEdit={() => state.edit(key)}
        onCommit={(value) => {
          state.edit(null);
          setDrawerRate(drawer, value / mult);
        }}
        onCancel={() => state.edit(null)}
        onMiddle={() => setDrawerRate(drawer, 0)}
        onWheel={(direction, ctrl, shift) =>
          state.wheelEdit(key, steppedRate(shown, direction, ctrl, shift) / mult, (v) =>
            setDrawerRate(drawer, v),
          )
        }
        tip={() => ({
          title: set ? "Target rate" : "No rate yet",
          rows: set
            ? [
                [
                  RULE_NAME[drawer.rule],
                  `${formatCompact(shown)} ${rateSuffixForKind(line.kind).trim()}`,
                ],
              ]
            : undefined,
          notes: drawer.unmet
            ? [{ text: "The plan cannot reach this rate.", tone: "red" }]
            : undefined,
          actions: [
            { input: "left", label: "Type it (2.5k, 1/3)" },
            { input: "wheel", label: "+1, Ctrl 10, Shift 100" },
            { input: "middle", label: "Clear" },
          ],
        })}
      />
    </>
  );
}

function ruleMeaning(drawer: RailDrawer): string {
  const verb = drawer.source ? "draws from it" : "puts in it";
  switch (drawer.rule) {
    case "ignore":
      return `No target: the plan ${verb} whatever it needs.`;
    case "at-least":
      return `The plan ${verb} at least the rate.`;
    case "exact":
      return `The plan ${verb} exactly the rate.`;
    case "at-most":
      return `The plan ${verb} no more than the rate.`;
  }
}

function PortControls({ pin, line, state }: { pin: RailPin; line: RailLine; state: RailState }) {
  const mult = rateMultiplierForKind(line.kind);
  const key = `port:${pin.nodeId}:${pin.handle}`;
  const wheeled = state.wheeled[key];
  const perSecond = wheeled ?? pin.ratePerSecond;
  const shown = perSecond * mult;
  const side = pin.output ? "output" : "input";
  return (
    <>
      <RuleKey
        mark="="
        tone="gold"
        label={`Release the ${pin.machine}'s ${side}`}
        onClick={(event) => {
          event.stopPropagation();
          setPortRate(pin.nodeId, pin.handle, 0);
        }}
        onMiddle={() => setPortRate(pin.nodeId, pin.handle, 0)}
        tip={() => ({
          title: `Set on the ${pin.machine}'s ${side}`,
          notes: [
            {
              text: `The machine runs so this ${side} ${pin.output ? "gives" : "takes"} exactly it.`,
              tone: "muted",
            },
          ],
          actions: [
            { input: "left", label: "Let the plan decide" },
            { input: "middle", label: "Clear" },
          ],
        })}
      />
      <RateBox
        label={`Rate set on the ${pin.machine}'s ${side}`}
        text={formatCompact(shown)}
        gold
        editing={state.editing === key}
        initial={formatAmountWithSuffix(shown)}
        onStartEdit={() => state.edit(key)}
        onCommit={(value) => {
          state.edit(null);
          setPortRate(pin.nodeId, pin.handle, value / mult);
        }}
        onCancel={() => state.edit(null)}
        onMiddle={() => setPortRate(pin.nodeId, pin.handle, 0)}
        onWheel={(direction, ctrl, shift) =>
          state.wheelEdit(key, steppedRate(shown, direction, ctrl, shift) / mult, (v) =>
            setPortRate(pin.nodeId, pin.handle, v),
          )
        }
        tip={() => ({
          title: `Rate set on the ${pin.machine}'s ${side}`,
          actions: [
            { input: "left", label: "Type it (2.5k, 1/3)" },
            { input: "wheel", label: "+1, Ctrl 10, Shift 100" },
            { input: "middle", label: "Clear" },
          ],
        })}
      />
    </>
  );
}

/** A line nothing sets: the rule key on Any and a "Set" box, as a port's on the card. */
function OpenLineControls({
  line,
  sources,
  state,
}: {
  line: RailLine;
  sources: boolean;
  state: RailState;
}) {
  const mult = rateMultiplierForKind(line.kind);
  const key = `line:${sources ? "in" : "out"}:${line.key}`;
  const only = line.open.length === 1 ? line.open[0]! : undefined;
  const side = sources ? "input" : "output";
  const tip = (): TipContent => ({
    title: "Rate: the plan decides",
    notes: [
      {
        text: only
          ? `Sets the ${only.machine}'s ${side}, as on its card.`
          : `Makes a drawer for it, wired to the ${line.open.length} ${side}s waiting for it.`,
        tone: "muted",
      },
    ],
    actions: only
      ? [
          { input: "left", label: "Type it (2.5k, 1/3)" },
          { input: "wheel", label: "+1, Ctrl 10, Shift 100" },
        ]
      : [{ input: "left", label: "Type it (2.5k, 1/3)" }],
  });
  const wheeled = state.wheeled[key];
  return (
    <>
      <RuleKey
        mark="~"
        tone="muted"
        label={`Rate of ${line.label}: the plan decides`}
        onClick={(event) => {
          event.stopPropagation();
          state.edit(key);
        }}
        tip={tip}
      />
      <RateBox
        label={`Set a rate for ${line.label}`}
        text={wheeled !== undefined ? formatCompact(wheeled * mult) : ""}
        gold={wheeled !== undefined && wheeled > 0}
        editing={state.editing === key}
        initial={String(Number(((only ? only.perSecond : line.amount) * mult).toPrecision(7)))}
        onStartEdit={() => state.edit(key)}
        onCommit={(value) => {
          state.edit(null);
          if (value > 0) setLineRate(line, sources, value / mult);
        }}
        onCancel={() => state.edit(null)}
        onWheel={
          only
            ? (direction, ctrl, shift) => {
                const now = (wheeled ?? only.perSecond) * mult;
                state.wheelEdit(key, steppedRate(now, direction, ctrl, shift) / mult, (v) =>
                  setPortRate(only.nodeId, only.handle, v),
                );
              }
            : undefined
        }
        tip={tip}
      />
    </>
  );
}

function RuleMenu({
  drawer,
  x,
  y,
  onClose,
}: {
  drawer: RailDrawer;
  x: number;
  y: number;
  onClose: () => void;
}) {
  // The board's own menu, so it follows the interface zoom as every other menu does.
  return (
    <BoardMenu x={x} y={y} label="Rule" width={210} onClose={onClose}>
      {RULE_STEPS.map((rule) => (
        <MenuRow
          key={rule}
          label={RULE_NAME[rule]}
          detail={RULE_MARK[rule]}
          checked={rule === drawer.rule}
          onClick={() => {
            onClose();
            setDrawerRule(drawer, rule);
          }}
        />
      ))}
    </BoardMenu>
  );
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

function MachineGlyph({ entry }: { entry: RailMachine }) {
  const icons = useMachineHandlerIcons();
  const icon = entry.powerSourceId ? powerIcon(entry.powerSourceId) : icons.get(entry.handlerId);
  if (!icon) return <span className="rail-icon" />;
  return (
    <span className="rail-icon">
      <ResourceIcon
        resource={{ ...(icon as object), amount: 1, consumed: true } as never}
        size="sm"
        showAmount={false}
        bare
        tooltip={false}
        iconPixelSize={machineArtPixels(20)}
        className="rail-icon-art"
      />
    </span>
  );
}

function GroupRow({ name, entries }: { name: string; entries: RailMachine[] }) {
  const [hot, setHot] = useState(false);
  const go = () =>
    walkCards(
      `machine:${name}`,
      entries.map((e) => e.nodeId),
    );
  return (
    <div
      className="rail-group"
      style={{ height: ROW_H }}
      data-hot={hot ? "" : undefined}
      onClick={go}
      onAuxClick={(event) => {
        if (event.button === 1) go();
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      {...tipProps(
        `group|${name}`,
        () => ({
          title: name,
          actions: [
            { input: "left", label: "Go to its cards one by one" },
            { input: "middle", label: "Go to its cards one by one" },
          ],
        }),
        { enter: () => setHot(true), leave: () => setHot(false) },
      )}
    >
      <div className="rail-row" style={{ top: 0, height: ROW_H }}>
        <MachineGlyph entry={entries[0]!} />
        <span className="rail-name" style={{ color: hot ? CC.gold : CC.ink }}>
          {name}
        </span>
      </div>
    </div>
  );
}

/**
 * The line's tier and amps chips are the card's own (`TierChip`, `AmpsChip`) on the card's own model and actions, so a
 * click, a wheel step or a typed amps value writes exactly what it does on the card.
 */
function MachineChips({ nodeId }: { nodeId: string }) {
  const projectNode = useFactoryStore((s) => s.project.nodes.find((n) => n.id === nodeId));
  const recipe = useFactoryStore((s) =>
    s.project.recipes.find((r) => r.id === s.project.nodes.find((n) => n.id === nodeId)?.recipeId),
  );
  const result = useFactoryStore((s) => s.lastResult.nodes[nodeId]);
  if (!projectNode || !recipe) return null;
  return <MachineChipsFor data={{ projectNode, recipe, result }} />;
}

function MachineChipsFor({ data }: { data: RecipeNodeData }) {
  const { view, actions } = useCleanCardModel(data, false);
  const nodeId = view.nodeId;
  const always = () => true;
  return (
    <span className="rail-chips" onClick={(event) => event.stopPropagation()}>
      {view.amps ? (
        <AmpsChip
          amps={view.amps}
          tier={view.tier?.label}
          tip={powerPanelTip(view, "amps")}
          onSet={actions.setAmps}
          wasClick={always}
        />
      ) : null}
      {view.tier ? (
        <TierChip
          label={view.tier.label}
          tip={
            view.amps
              ? powerPanelTip(view, "tier")
              : { id: `${nodeId}|tier`, title: view.tier.title }
          }
          fixed={view.tier.fixed}
          onStep={actions.stepTier}
          wasClick={always}
        />
      ) : null}
    </span>
  );
}

const MachineRow = memo(function MachineRow({
  entry,
  peak,
  state,
}: {
  entry: RailMachine;
  peak: boolean;
  state: RailState;
}) {
  useFontEpoch();
  const railWidth = useContext(RailWidthContext);
  const [hot, setHot] = useState(false);
  // The count as it was when its box opened: Escape puts it back, as the box sets as it goes.
  const opened = useRef<PinSnapshot | undefined>(undefined);
  const colors = entry.tier ? tierChipColors(entry.tier) : undefined;
  const countKey = `count:${entry.nodeId}`;
  const wheeled = state.wheeled[countKey];
  const base = entry.pinned ? entry.pin! : Math.max(1, Math.ceil(entry.count - 1e-9));
  const shownPin = wheeled !== undefined ? wheeled : entry.pinned ? entry.pin! : 0;
  const set = shownPin > 0;
  const made = peak ? entry.madeEuT : entry.avgMadeEuT;
  const used = peak ? entry.euT : entry.avgEuT;
  const steam = peak ? entry.steamLs : entry.avgSteamLs;
  const tooLow = entry.state === "under-powered";
  // What it draws, grey beside the tier: the unit is dropped when there is no room for it (the mod's rule).
  const tierLabel = entry.tier
    ? `${entry.tier}${entry.isMultiblock && (entry.amps ?? 0) > 1 ? ` ${entry.amps}A` : ""}`
    : "";
  const upTo = entry.rule === "upTo";
  const reason = shownReason(entry.upTo);
  const countText = `×${machinesText(entry.count)}`;
  const room =
    railWidth -
    MACHINE_INDENT -
    CONTROLS_W -
    18 -
    3 -
    (tierLabel ? measureClean(tierLabel, RAIL_FONT, 600) + 10 : 0) -
    measureClean(countText, RAIL_FONT);
  const withUnit = (number: string, unit: string) =>
    measureClean(`${number} ${unit}`, RAIL_FONT) <= room ? `${number} ${unit}` : number;
  let eu = "";
  if (tooLow) eu = "TIER!";
  else if (made !== undefined && made > 0)
    eu = withUnit(`+${formatCompact(powerDisplayFromEuT(made))}`, powerDisplaySuffix());
  else if (steam !== undefined) eu = withUnit(formatCompact(steam), "L/s");
  else if (used !== undefined)
    eu = withUnit(formatCompact(powerDisplayFromEuT(used)), powerDisplaySuffix());
  const togglePin = () => stepPinRule(entry.nodeId, base);
  const go = () => frameCards([entry.nodeId]);
  const wheelCount = (direction: 1 | -1) => {
    const now = wheeled ?? (entry.pinned ? entry.pin! : base);
    const next = entry.pinned || wheeled !== undefined ? now + direction : base + direction;
    state.wheelEdit(countKey, next < 1 ? 0 : next, (v) => pinCount(entry.nodeId, v));
  };
  const lines: TipContent = {
    title: entry.label,
    sub: upTo && entry.pinned
      ? `${machinesText(entry.count)} of ${machinesText(entry.pin!)} machines`
      : `${machinesText(entry.count)} machines${entry.pinned ? " (exactly)" : ""}`,
    notes: [
      ...(upTo && entry.upTo?.reason
        ? [
            {
              text: `${UP_TO_WORD[entry.upTo.reason]}. ${upToSentence(entry.upTo) ?? ""}`.trim(),
              tone: "muted" as const,
            },
          ]
        : []),
      ...(eu
        ? [
            {
              text: `${eu} ${peak ? "peak" : "average"}`,
              tone: tooLow ? ("red" as const) : ("muted" as const),
            },
          ]
        : []),
    ],
    actions: [
      { input: "left", label: "Go to the card" },
      ...(TASKS_ENABLED ? [{ input: "right" as const, label: "Add to a task" }] : []),
    ],
  };
  return (
    <div
      className="rail-machine"
      style={{ height: ROW_H }}
      data-hot={hot ? "" : undefined}
      data-rail-machine={entry.nodeId}
      onClick={go}
      onContextMenu={(event) => {
        if (!TASKS_ENABLED) return;
        event.preventDefault();
        void openAddToTask(cardsForTask(entry.nodeId, false), {
          left: event.clientX,
          top: event.clientY,
          bottom: event.clientY,
        });
      }}
      onAuxClick={(event) => {
        if (event.button === 1) go();
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      {...tipProps(`machine|${entry.nodeId}`, () => lines, {
        enter: () => setHot(true),
        leave: () => setHot(false),
      })}
    >
      <div className="rail-row" style={{ top: 0, height: ROW_H, paddingLeft: 30 }}>
        {colors ? <MachineChips nodeId={entry.nodeId} /> : null}
        <span
          className="rail-eu"
          data-make={made && made > 0 ? "" : undefined}
          data-low={tooLow ? "" : undefined}
        >
          {eu}
        </span>
        <span
          className="rail-count"
          data-reason={reason}
          style={reason ? { color: UP_TO_COLOR[reason] } : undefined}
        >
          {countText}
        </span>
        <div className="rail-controls" onClick={(event) => event.stopPropagation()}>
          <RuleKey
            // ≤ Up to (a count wheeled onto Any is Up to), = Exactly, ~ Any.
            mark={entry.rule === "exact" ? "=" : upTo || set ? "≤" : "~"}
            tone={set ? "gold" : "muted"}
            label={`Pin the ${entry.label}`}
            onClick={(event) => {
              event.stopPropagation();
              togglePin();
            }}
            onWheel={() => togglePin()}
            onMiddle={() => {
              if (entry.pinned) pinCount(entry.nodeId, 0);
            }}
            tip={() =>
              entry.pinned
                ? {
                    title: PIN_RULE_LABEL[entry.rule],
                    notes: [
                      {
                        text: upTo
                          ? `Never more than ${machinesText(entry.pin!)}.`
                          : `Exactly ${machinesText(entry.pin!)}.`,
                        tone: "muted",
                      },
                    ],
                    actions: [
                      { input: "left", label: upTo ? "Make it exact" : "Let the plan decide" },
                      { input: "middle", label: "Let the plan decide" },
                    ],
                  }
                : {
                    title: PIN_RULE_LABEL[entry.rule],
                    notes: [
                      {
                        text: "The plan decides how many.",
                        tone: "muted",
                      },
                    ],
                    actions: [{ input: "left", label: `Pin it at ${base}` }],
                  }
            }
          />
          <RateBox
            label={`Pinned count of the ${entry.label}`}
            text={machinesText(shownPin)}
            gold={set}
            editing={state.editing === countKey}
            // What the box shows, a wheel step not yet set included.
            initial={set ? String(shownPin) : ""}
            onStartEdit={() => {
              opened.current = pinSnapshot(entry.nodeId);
              state.edit(countKey);
            }}
            onCommit={(value) => {
              state.edit(null);
              pinCount(entry.nodeId, value);
            }}
            onCancel={() => state.edit(null)}
            onMiddle={() => {
              if (entry.pinned) pinCount(entry.nodeId, 0);
            }}
            onWheel={(direction) => wheelCount(direction)}
            // The card's count box steps what it holds the same way, and sets it as it goes.
            onWheelDraft={(text, direction) => wheelDraft(text, { value: entry.count }, direction)}
            onLive={(value) => pinCount(entry.nodeId, value)}
            onRevert={() => restorePin(entry.nodeId, opened.current)}
            tip={() => ({
              title: "Machine count",
              actions: [
                { input: "left", label: "Type a pinned count" },
                { input: "wheel", label: "One more or fewer (below one unpins)" },
                { input: "middle", label: "Let the plan decide" },
              ],
            })}
          />
        </div>
      </div>
    </div>
  );
});
