"use client";

import "../clean.css";
import { useDeviceSettings } from "@/lib/device-settings";
import "./special.css";
import { useCardTaskStatus } from "@/lib/tasks/task-link-index";
import { TASK_STATUS_COLOR } from "@/lib/tasks/task-links";

import { Handle, Position } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { CardActionsMenu } from "../menus/CardActionsMenu";
import { CropPickerMenu } from "../../CropPickerMenu";
import { checklistLocked } from "../../RecipeNode";
import {
  CardFoot,
  CountBox,
  CleanPortRow,
  StripChip,
  TierChip,
  AmpsChip,
  glyph,
} from "../CleanCard";
import { frameTone, type CleanCardView, type CleanChipView } from "../clean-model";
import { glanceFace } from "../glance";
import { ensureInteractionHost, tipAttrs, useClickSlop, type TipSpec } from "../interaction";
import { menuTip, powerPanelTip } from "../interaction/tips";
import { syncPromptPhase } from "../../virtual/prompt-phase";
import { MachineListMenu } from "../menus/MachineListMenu";
import { OptionListMenu } from "../menus/OptionListMenu";
import { SettingsSheet } from "../menus/SettingsSheet";
import { anchorOf, type MenuAnchor } from "../menus/MenuPortal";
import {
  countRowsTip,
  gearTip,
  machineNameTip,
  powerRowTip,
  ruleTip,
  tierChipTip,
  useCardTipFacts,
  type CardTipFacts,
} from "../menus/card-tips";
import {
  recipeHeatNeed,
  settingControls,
  settingPatch,
  steppedOption,
  type SettingControl,
} from "../menus/settings-model";
import { SpecialSheet } from "./SpecialSheets";
import { cloneWithSound } from "@/lib/sound/sfx";
import { wheelChangesValues } from "@/lib/device-settings";
import type { SpecialActions, SpecialContext, SpecialModel } from "./use-special";
import type { SpecialChip, SpecialSection, SpecialView } from "./special-model";

/** The bolt-box and the gauge, as pixel runs (the mod's `PowerPicker.bolt` and `gauge`), drawn once as data URIs. */
function runsSvg(runs: number[][], width: number, height: number, fill: string): string {
  const rects = runs
    .map(([x, y, w]) => `<rect x='${x}' y='${y}' width='${w}' height='1'/>`)
    .join("");
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}' shape-rendering='crispEdges' fill='${fill}'>${rects}</svg>`)}")`;
}
const GAUGE_RUNS = [
  [2, 0, 5],
  [1, 1, 1],
  [7, 1, 1],
  [0, 2, 1],
  [6, 2, 1],
  [8, 2, 1],
  [0, 3, 1],
  [5, 3, 1],
  [8, 3, 1],
  [0, 4, 1],
  [4, 4, 1],
  [8, 4, 1],
  [0, 5, 1],
  [3, 5, 2],
  [8, 5, 1],
  [1, 6, 1],
  [7, 6, 1],
];
export const GAUGE_URL = runsSvg(GAUGE_RUNS, 9, 8, "#AEBCEB");

function dataKindOf(view: SpecialView): string {
  return view.kind;
}

/** A section's rule: its share of the machine's time on the left, its circuit and keys on the right. */
function SectionRule({
  view,
  section,
  row,
  actions,
  wasClick,
}: {
  view: SpecialView;
  section: SpecialSection;
  row: number;
  actions: SpecialActions;
  wasClick: (event: MouseEvent) => boolean;
}) {
  const rule = section.rule!;
  const key = (
    kind: "up" | "down" | "off",
    enabled: boolean,
    label: string,
    run: () => void,
    note?: string,
  ) => (
    <div
      role="button"
      tabIndex={enabled ? 0 : -1}
      className="sp-rk nowheel"
      data-wheel-value=""
      data-kind={kind}
      data-disabled={enabled ? undefined : ""}
      aria-label={label}
      aria-disabled={!enabled}
      {...tipAttrs({
        id: `${view.nodeId}|rule|${section.section}|${kind}`,
        title: label,
        notes: note ? [{ text: note, tone: "muted" }] : [],
      })}
      onClick={(event) => {
        glyph(event);
        if (enabled && wasClick(event)) run();
      }}
    />
  );
  return (
    <div
      className="sp-rule"
      style={{ gridRow: row }}
      data-first={section.section === 0 ? "" : undefined}
    >
      <span className="sp-pct">{rule.pct}</span>
      <span className="sp-word" data-unused={rule.unused ? "" : undefined}>
        {rule.word}
      </span>
      {rule.circuit ? (
        <span
          className="sp-circ"
          {...tipAttrs({
            id: `${view.nodeId}|circuit|${section.section}`,
            title: "Programmed circuit",
            notes: [{ text: "Not consumed.", tone: "muted" }],
          })}
        >
          {rule.circuit.resource ? (
            <ResourceIcon
              itemZoom={1.5}
              resource={{ ...rule.circuit.resource, amount: 1, chance: undefined }}
              bare
              tooltip={false}
              showAmount={false}
              showConsumedState={false}
              className="sp-circuit"
            />
          ) : null}
        </span>
      ) : null}
      {key("up", rule.canUp, "Move this recipe up", () => actions.moveSection(section.section, -1))}
      {key("down", rule.canDown, "Move this recipe down", () =>
        actions.moveSection(section.section, 1),
      )}
      {key(
        "off",
        true,
        "Take this recipe off the machine",
        () => actions.removeSection(section.section),
        "Its wires are removed too.",
      )}
    </div>
  );
}

/** The two dashed boxes of a holder with nothing on it: a wire dropped on either makes the card take its resource. */
function Sockets({ view }: { view: SpecialView }) {
  const sockets = view.sockets!;
  const one = (side: "input" | "output", label: string, handle: string, hint: string) => (
    <div
      className="sp-socket"
      data-side={side}
      data-resource-edge-anchor="true"
      data-resource-node-id={view.nodeId}
      data-resource-handle-id={handle}
      {...tipAttrs({
        id: `${view.nodeId}|socket|${side}`,
        title: label,
        notes: [
          {
            text:
              side === "input"
                ? "Wire a machine's output (or a tank) here."
                : "Wire a machine's input (or a tank) here.",
            tone: "muted",
          },
        ],
      })}
    >
      <span className="sp-socket-word">{label}</span>
      <span className="sp-socket-hint">{hint}</span>
      <Handle
        id={handle}
        type={side === "input" ? "target" : "source"}
        position={side === "input" ? Position.Left : Position.Right}
        data-resource-handle="true"
        data-resource-node-id={view.nodeId}
        data-resource-handle-id={handle}
        aria-label={label}
        className="resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0 cursor-crosshair"
      />
    </div>
  );
  return (
    <>
      <div className="sp-sockets" data-side="input" style={{ gridRow: 2 }}>
        {one("input", sockets.take, sockets.takeHandle, "takes an output")}
      </div>
      <div className="sp-sockets" data-side="output" style={{ gridRow: 2 }}>
        {one("output", sockets.give, sockets.giveHandle, "feeds an input")}
      </div>
    </>
  );
}

function Rail({
  side,
  ports,
  section,
  row,
  unset,
  wasClick,
  power,
  shared,
}: {
  side: "input" | "output";
  ports: SpecialSection["inputs"];
  section: number;
  row: number;
  unset: boolean;
  wasClick: (event: MouseEvent) => boolean;
  power?: React.ReactNode;
  shared: boolean;
}) {
  return (
    <div className="cc-rail" data-side={side} style={{ gridRow: row }} data-section={section}>
      {ports.length === 0 && shared ? (
        <div className="sp-none">{side === "input" ? "No input" : "No output"}</div>
      ) : null}
      {ports.map((p) => (
        <CleanPortRow key={p.key} p={p} wasClick={wasClick} unset={unset} />
      ))}
      {power}
    </div>
  );
}

function SpecialChipView({
  chip,
  nodeId,
  control,
  needK,
  onStep,
  onOpen,
  wasClick,
}: {
  chip: SpecialChip;
  nodeId: string;
  control?: SettingControl;
  needK?: number;
  onStep: (id: string, direction: -1 | 1) => void;
  onOpen: (id: string, anchor: MenuAnchor) => void;
  wasClick: (event: MouseEvent) => boolean;
}) {
  const [draft, setDraft] = useState<string>();
  if (!chip.edit)
    return (
      <StripChip
        chip={chip as CleanChipView}
        nodeId={nodeId}
        control={control}
        needK={needK}
        onStep={onStep}
        onOpen={onOpen}
        wasClick={wasClick}
      />
    );
  const { edit } = chip;
  const commit = () => {
    if (draft === undefined) return;
    const text = draft;
    setDraft(undefined);
    edit.commit(text);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className="cc-sc nowheel"
      data-wheel-value=""
      data-label={chip.label}
      data-editing={draft !== undefined ? "" : undefined}
      {...tipAttrs({
        id: `${nodeId}|setting|${chip.id}`,
        title: chip.label,
        // A worked-out number (a crop card's machines) explains itself in notes; a knob says what it is set to.
        rows: edit.notes ? [] : [{ label: "Set to", value: chip.value }],
        notes: edit.notes?.map((text) => ({ text, tone: "muted" as const })),
        actions: [
          { input: "left", label: "Type a value" },
          { input: "wheel", label: "Step" },
        ],
      })}
      style={{ left: chip.x, top: chip.y, width: chip.width }}
      onClick={(event) => {
        glyph(event);
        if (draft === undefined && wasClick(event) && !checklistLocked()) setDraft(edit.text);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        glyph(event);
        onStep(chip.id, -1);
      }}
      onWheel={(event) => {
        if (checklistLocked() || !wheelChangesValues()) return;
        event.stopPropagation();
        onStep(chip.id, event.deltaY < 0 ? 1 : -1);
      }}
    >
      {draft === undefined ? (
        chip.value
      ) : (
        <input
          autoFocus
          value={draft}
          inputMode="decimal"
          aria-label={chip.label}
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

export interface SpecialCardProps {
  model: SpecialModel;
  recipe: Recipe;
  node: FactoryNode;
}

/**
 * The clean card for what the plain one cannot be: a machine running several recipes (a rule over each), a
 * generator (amber name, EU out, its settings and warnings) and the two holders (dashed sockets until something is
 * wired, then the one port; a gauge or a tank for a picture). The same head, rails, picture, count and strip as the
 * plain card, in the same classes.
 */
export function SpecialCard({ model, recipe, node }: SpecialCardProps) {
  const { view, actions, context } = model;
  const { wasClick, onPointerDownCapture } = useClickSlop();
  const { zoomedOutNames: glanceNames, problemOutlines } = useDeviceSettings();
  // A task board somewhere on this device is about this card: a dot before the name, as on the plain card.
  const taskStatus = useCardTaskStatus(view.nodeId);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => ensureInteractionHost(), []);
  useEffect(() => {
    // Every prompt on the board, and a ring's outline, blinks off one clock (virtual/prompt-phase.ts).
    if (view.unset || view.loop) syncPromptPhase();
  }, [view.unset, view.loop]);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const duplicateNode = useFactoryStore((state) => state.duplicateNode);
  const [listOpen, setListOpen] = useState(false);
  const [listAnchor, setListAnchor] = useState<MenuAnchor>();
  const [sheetAnchor, setSheetAnchor] = useState<MenuAnchor>();
  const [chipList, setChipList] = useState<{ id: string; anchor: MenuAnchor }>();
  const [cropOpen, setCropOpen] = useState(false);
  const [menu, setMenu] = useState<{
    kind: "actions";
    x: number;
    top: number;
    bottom: number;
    hangsFrom?: Element;
  }>();
  const updateNode = useFactoryStore((state) => state.updateNode);
  const locked = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const shared = view.kind === "shared";
  const holder = view.kind === "custom-rate" || view.kind === "tank";
  // A shared machine's and a crop's settings are the machine's own controls (the plain card's gear sheet and chips).
  const machineSheet = context.sheet.kind === "machine";
  const tipFacts: CardTipFacts = useCardTipFacts(recipe, node);
  const controls = useMemo(
    () => (machineSheet ? settingControls(recipe, node) : []),
    [machineSheet, recipe, node],
  );
  const heatNeed = useMemo(
    () => (machineSheet ? recipeHeatNeed(recipe, node) : undefined),
    [machineSheet, recipe, node],
  );
  const stepChip = (id: string, direction: -1 | 1) => {
    const control = controls.find((entry) => entry.id === id);
    if (!control) {
      actions.stepChip(id, direction);
      return;
    }
    const next = steppedOption(control, direction);
    if (next) updateNode(node.id, settingPatch(recipe, node, control.id, next.key));
  };
  // The tips the plain card has, built from what this card knows.
  const tipView = {
    nodeId: view.nodeId,
    name: view.name,
    count: view.count,
    tier: view.tier,
    amps: view.amps,
    hasPicker: view.hasPicker,
    power: view.power,
  } as unknown as CleanCardView;

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!wasClick(event)) return;
    // The menu hangs under the key, as the mod's (RecipeCard.openActions).
    const card = event.currentTarget.closest("[data-node-glance-root]") ?? undefined;
    const r = (card ?? event.currentTarget).getBoundingClientRect();
    setMenu(
      menu
        ? undefined
        : { kind: "actions", x: r.left, top: r.top, bottom: r.bottom, hangsFrom: card },
    );
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

  // Rows: the head, then per recipe a rule (shared only) and its rails, then the shared machine's power row, then the strip.
  const sections = view.sections;
  const rowOf = (index: number) => (shared ? 3 + 2 * index : 2);
  const ruleRowOf = (index: number) => 2 + 2 * index;
  const lastRailRow = rowOf(sections.length - 1);
  const powerRow = shared && view.power ? lastRailRow + 1 : undefined;
  const pictureEnd = (powerRow ?? lastRailRow) + 1;
  const stripRow = pictureEnd;
  const countText = view.count?.text ?? "";
  const glance = glanceFace(
    view.glyph === "gauge" ? GAUGE_URL : view.glanceArt ? `url(${view.glanceArt})` : undefined,
    view.glance,
  );

  const powerRowView = view.power ? (
    <div
      className="cc-row"
      data-power=""
      data-side="input"
      data-stalled={view.power.stalled ? "" : undefined}
      {...tipAttrs(view.amps ? powerPanelTip(tipView, "power") : powerRowTip(tipView, tipFacts))}
    >
      <span className="cc-bolt" />
      <span className="cc-num" data-unit={view.power.unit}>
        {view.power.number}
      </span>
      <span className="cc-pname">{view.power.name}</span>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="cc-card sp-card"
      data-node-glance-root=""
      data-kind={dataKindOf(view)}
      data-selected={view.selected ? "" : undefined}
      data-cannot-run={view.cannotRun ? "" : undefined}
      data-unset={view.unset ? "" : undefined}
      data-empty={view.sockets ? "" : undefined}
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
          onClick={openMenu}
        />
        <div
          role="button"
          tabIndex={0}
          className="cc-key"
          data-glyph="gear"
          data-hatch-menu-anchor=""
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
        {view.cropKey ? (
          <div
            role="button"
            tabIndex={0}
            className="cc-key"
            data-glyph="sprout"
            data-crop-picker-toggle=""
            aria-label="Pick a crop"
            aria-haspopup="dialog"
            aria-expanded={cropOpen}
            {...tipAttrs({
              id: `${view.nodeId}|crop`,
              title: "Pick a crop",
              notes: [{ text: "What this farm plants.", tone: "muted" }],
              actions: [{ input: "left", label: "Pick another crop" }],
            })}
            onClick={(event) => {
              glyph(event);
              if (wasClick(event) && !checklistLocked()) setCropOpen((open) => !open);
            }}
          />
        ) : null}
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
          data-tone={view.nameTone === "ink" ? undefined : view.nameTone}
          data-picker={view.hasPicker ? "" : undefined}
          data-open={listOpen ? "" : undefined}
          data-clip={view.nameSize <= 9 ? "" : undefined}
          data-machine-menu-toggle={view.hasPicker ? "" : undefined}
          data-wheel-steps={view.hasPicker ? "" : undefined}
          data-wheel-value={view.hasPicker ? "" : undefined}
          data-menu-anchor=""
          {...tipAttrs(specialNameTip(view, tipView, tipFacts))}
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
              selectedId={context.selectedMachineHandler?.id ?? ""}
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
            tip={powerPanelTip(tipView, "amps")}
            onSet={actions.setAmps}
            wasClick={wasClick}
          />
        ) : null}
        {view.tier ? (
          <TierChip
            label={view.tier.label}
            tip={
              view.amps
                ? powerPanelTip(tipView, "tier")
                : view.kind === "power" || view.kind === "crop"
                  ? { id: `${view.nodeId}|tier`, title: "Tier", sub: view.tier.title }
                  : tierChipTip(tipView, tipFacts)
            }
            fixed={view.tier.fixed}
            onStep={actions.stepTier}
            wasClick={wasClick}
          />
        ) : null}
      </div>

      {sections.map((section, index) => (
        <SectionBlock
          key={section.section}
          view={view}
          section={section}
          index={index}
          ruleRow={ruleRowOf(index)}
          railRow={rowOf(index)}
          actions={actions}
          wasClick={wasClick}
          shared={shared}
          empty={view.sockets !== undefined}
          power={index === sections.length - 1 && !shared ? powerRowView : undefined}
          pick={view.pick === true}
          onPick={() => setCropOpen(true)}
        />
      ))}
      {cropOpen ? <CropPickerMenu nodeId={node.id} onClose={() => setCropOpen(false)} /> : null}
      {view.sockets ? <Sockets view={view} /> : null}
      {powerRow ? (
        <div className="cc-rail" data-side="input" style={{ gridRow: powerRow }} data-power-rail="">
          {powerRowView}
        </div>
      ) : null}

      {view.pick ? null : (
        <div
          className="cc-pic sp-pic"
          style={{ gridRow: `2 / ${pictureEnd}` }}
          data-holder={holder ? "" : undefined}
        >
          <Picture view={view} context={context} />
          {view.count ? (
            <CountBox
              view={view.count}
              tip={countRowsTip(tipView, tipFacts.shared)}
              ruleTip={ruleTip(tipView)}
              onSet={actions.setCount}
              onStep={actions.stepCount}
              onRule={actions.setRule}
              wasClick={wasClick}
            />
          ) : null}
        </div>
      )}

      {view.chips.length > 0 ? (
        <div className="cc-strip" style={{ height: view.stripHeight, gridRow: stripRow }}>
          {view.chips.map((chip) => (
            <SpecialChipView
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
      {view.warnings.length > 0 ? (
        <div className="sp-warns" style={{ gridRow: stripRow + 1 }}>
          {view.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {view.foot ? <CardFoot nodeId={view.nodeId} foot={view.foot} gridRow={stripRow + 2} /> : null}

      <div
        className="cc-glance"
        data-node-detail="glance"
        data-count={countText}
        data-name={glanceNames ? view.name : undefined}
        data-bar={glance["data-bar"]}
        data-tone={glance["data-tone"]}
        aria-hidden
        style={glance.style}
      >
        {glance.text}
      </div>

      {menu ? (
        <CardActionsMenu
          anchor={{ left: menu.x, top: menu.top, bottom: menu.bottom }}
          nodeId={node.id}
          onClose={() => setMenu(undefined)}
          onClone={() => cloneWithSound(duplicateNode, node.id)}
          onDelete={() => deleteNode(node.id)}
        />
      ) : null}
      {sheetAnchor ? (
        context.sheet.kind === "machine" ? (
          <SettingsSheet
            nodeId={node.id}
            anchor={sheetAnchor}
            numbers={context.sheet.numbers}
            onClose={() => setSheetAnchor(undefined)}
          />
        ) : (
          <SpecialSheet
            anchor={sheetAnchor}
            rows={context.sheet.rows}
            readings={context.readings}
            locked={locked}
            foot={context.sheet.foot}
            onClose={() => setSheetAnchor(undefined)}
          />
        )
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
    </div>
  );
}

function SectionBlock({
  view,
  section,
  index,
  ruleRow,
  railRow,
  actions,
  wasClick,
  shared,
  empty,
  power,
  pick,
  onPick,
}: {
  view: SpecialView;
  section: SpecialSection;
  index: number;
  ruleRow: number;
  railRow: number;
  actions: SpecialActions;
  wasClick: (event: MouseEvent) => boolean;
  shared: boolean;
  empty: boolean;
  power?: React.ReactNode;
  pick: boolean;
  onPick: () => void;
}) {
  void index;
  return (
    <>
      {shared && section.rule ? (
        <SectionRule
          view={view}
          section={section}
          row={ruleRow}
          actions={actions}
          wasClick={wasClick}
        />
      ) : null}
      {pick ? (
        <div
          role="button"
          tabIndex={0}
          className="sp-pick"
          data-crop-picker-toggle=""
          style={{ gridRow: railRow }}
          {...tipAttrs({
            id: `${view.nodeId}|pick`,
            title: "Pick a crop",
            notes: [{ text: "Click to pick what this farm plants.", tone: "muted" }],
          })}
          onClick={(event) => {
            glyph(event);
            if (wasClick(event) && !checklistLocked()) onPick();
          }}
        >
          <span className="sp-pick-icon" />
          Pick a crop
        </div>
      ) : null}
      {empty || pick ? null : (
        <>
          <Rail
            side="input"
            ports={section.inputs}
            section={section.section}
            row={railRow}
            unset={view.unset}
            wasClick={wasClick}
            shared={shared}
            power={power}
          />
          <Rail
            side="output"
            ports={section.outputs}
            section={section.section}
            row={railRow}
            unset={view.unset}
            wasClick={wasClick}
            shared={shared}
          />
        </>
      )}
    </>
  );
}

function Picture({ view, context }: { view: SpecialView; context: SpecialContext }) {
  void context;
  if (view.glyph === "gauge")
    return <span className="sp-gauge" style={{ backgroundImage: GAUGE_URL }} />;
  if (view.art) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="cc-art" src={view.art} alt="" draggable={false} />;
  }
  if (view.icon?.iconPath || view.icon?.iconAtlas) {
    return (
      <ResourceIcon
        resource={{
          kind: "item",
          id: view.icon.id,
          amount: 1,
          displayName: view.icon.displayName,
          iconPath: view.icon.iconPath,
          iconAtlas: view.icon.iconAtlas,
          dominantColor: view.icon.dominantColor,
        }}
        bare
        tooltip={false}
        showAmount={false}
        showConsumedState={false}
        iconPixelSize={109}
        className="cc-machine"
      />
    );
  }
  return null;
}

function specialNameTip(view: SpecialView, tipView: CleanCardView, facts: CardTipFacts): TipSpec {
  if ((view.kind === "shared" || view.kind === "crop") && view.count)
    return machineNameTip(tipView, facts);
  if (view.kind === "crop") {
    return {
      id: `${view.nodeId}|name`,
      title: view.name,
      notes: [{ text: "Pick a crop to start producing.", tone: "muted" }],
    };
  }
  if (view.kind === "custom-rate") {
    return {
      id: `${view.nodeId}|name`,
      title: view.name,
      notes: [{ text: "Wire any port to this and it adopts that resource.", tone: "muted" }],
    };
  }
  if (view.kind === "tank") {
    return {
      id: `${view.nodeId}|name`,
      title: view.name,
      notes: [
        {
          text: "Empties cells into their fluid, or fills them, free and at once. It keeps up with the plan.",
          tone: "muted",
        },
      ],
    };
  }
  return { id: `${view.nodeId}|name`, title: view.name, sub: "Generator" };
}
