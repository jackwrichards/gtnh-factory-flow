"use client";

import "../clean.css";
import "./drawer.css";

import { Handle, Position } from "@xyflow/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { makeResourceKey } from "@/lib/model";
import type { FactoryStorage } from "@/lib/model/types";
import type { StorageRole } from "@/lib/model/storage-role";
import { rateMultiplierForKind } from "@/lib/model/rate-unit";
import { resourceLabel } from "@/lib/model/resources";
import { getCategoryPresentation } from "@/lib/model/category-presentation";
import { playBoardSound, suppressBoardSound } from "@/lib/board-sounds";
import { useFactoryStore } from "@/store/factory-store";
import type { BrowseMode as PortBrowseMode } from "@/components/browse-menu";
import { isWiringConnection } from "../../connection-drag";
import { buildStorageFlowScope } from "../../flow-scope";
import { makeResourceHandleId } from "../../resource-handles";
import { RULE_MARK, RULE_NAME, RULE_STEPS, useRateRule, type RateRule } from "../../rate-rule";
import { useRenderedHandles } from "../../use-rendered-handles";
import { usePortRowBrowse } from "../../use-port-row-browse";
import type { StorageNodeData } from "../../StorageNode";
import { checklistLocked } from "../../RecipeNode";
import { useFontEpoch } from "../text-measure";
import { TO_PRODUCT, TO_TRASH, bufferThroughput, buildDrawerView } from "./drawer-model";
import { DrawerIcon } from "./DrawerIcon";
import { BoardMenu, MenuLine, MenuRow } from "../menus/BoardMenu";
import { ensureInteractionHost, tipAttrs } from "../interaction";
import { setSpillHover, useSpillHover } from "../interaction/spill-hover";
import { startPromptClock } from "../../virtual/prompt-phase";
import type { TargetMode } from "@/lib/model/storage-target";
import { playEditSfx } from "@/lib/sound/sfx";
import { wheelChangesValues } from "@/lib/device-settings";

/** A press that moved this far (screen px) before release is a drag, not a click. */
const CLICK_SLOP = 3;

/**
 * One handle over the whole body, not two halves: a drawer holds one item, so "wire this up" is one gesture and the
 * far end decides which way it runs. Wires still dock through both port ids. Inline so React Flow's own handle
 * stylesheet can never reposition or resize it.
 */
const WELL_HANDLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  margin: 0,
  transform: "none",
  borderRadius: 0,
  border: "none",
  background: "transparent",
  opacity: 0,
  zIndex: 30,
};

function useNativeWheel(element: HTMLElement | null, onWheel: (event: WheelEvent) => void) {
  const handler = useRef(onWheel);
  useEffect(() => {
    handler.current = onWheel;
  });
  useEffect(() => {
    if (!element) return;
    const listener = (event: WheelEvent) => handler.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, [element]);
}

export function CleanDrawer({
  data,
  selected,
  role,
}: {
  data: StorageNodeData;
  selected: boolean;
  role: StorageRole;
}) {
  const { storage, result } = data;
  const fontEpoch = useFontEpoch();
  useEffect(() => ensureInteractionHost(), []);
  const category = useFactoryStore((state) =>
    getCategoryPresentation(state.project.recipes, storage.kind, storage.resourceId),
  );
  // The overview and the tooltips print rates: the drawer follows the rate dial.
  const rateUnit = useFactoryStore((state) => state.rateUnit);
  const powerUnit = useFactoryStore((state) => state.powerDisplayUnit);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  const scopeLit = useFactoryStore((state) => Boolean(state.hoveredFlowScope?.nodes[storage.id]));
  const scopePort = useFactoryStore((state) => {
    const ports = state.hoveredFlowScope?.ports;
    if (!ports) return false;
    const resource = { kind: storage.kind, id: storage.resourceId };
    return Boolean(
      ports[`${storage.id}|${makeResourceHandleId("input", resource)}`] ||
      ports[`${storage.id}|${makeResourceHandleId("output", resource)}`],
    );
  });
  const unanchored = useFactoryStore(
    (state) => state.lastResult?.plan?.unanchored.includes(storage.id) === true,
  );
  const unmet = useFactoryStore(
    (state) => state.lastResult?.plan?.unmetDrawers?.includes(storage.id) === true,
  );
  // The buffer's Forced tile lights with its makers' when one of them, or the tile itself, is under the pointer.
  const spillLit = useSpillHover((state) => state.drawerId === storage.id);
  // A buffer's makers' spills (their forced rows), totalled here: a number, so the selector is stable.
  const spill = useFactoryStore((state) => {
    let total = 0;
    for (const entry of state.lastResult?.plan?.spills ?? [])
      if (entry.drawerId === storage.id) total += entry.perSecond;
    return total;
  });
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const flipStorageSide = useFactoryStore((state) => state.flipStorageSide);
  const setDrainMode = useFactoryStore((state) => state.setStorageDrainMode);

  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
  const resourceLit = (hoveredFlowResourceKey ?? selectedFlowResourceKey) === resourceKey;
  const lit = scopeLit || scopePort || resourceLit;
  const label = resourceLabel(
    category ?? { id: storage.resourceId, displayName: storage.displayName },
  );
  const view = useMemo(
    () =>
      buildDrawerView({ storage, role, label, result, unanchored, unmet, linked: role !== "idle", spill }),
    // The rate and power dials change the strings (the units are read inside).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storage, role, label, result, unanchored, unmet, spill, rateUnit, powerUnit, fontEpoch],
  );
  // "Set rate" blinks off the board's one clock (virtual/prompt-phase.ts).
  useEffect(() => {
    if (view.prompt) startPromptClock();
  }, [view.prompt]);

  const inputHandleId = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const outputHandleId = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  // A power card's fuel switch can retarget a drawer: re-measure, or React Flow keeps the old handle bounds.
  useRenderedHandles(storage.id, [inputHandleId, outputHandleId]);

  const browse = (mode: PortBrowseMode) => {
    browseResource(
      {
        kind: storage.kind,
        id: storage.resourceId,
        displayName: label,
        iconPath: storage.iconPath,
        iconAtlas: storage.iconAtlas,
        dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
      },
      mode,
    );
  };
  // The item is the control, as a port row is: a click is the recipes that make it, a right click the ones that use
  // it, R and U the same, a press on touch a menu of both. The rest of the drawer keeps its own right click (the
  // rate box opens the drawer's menu) and a click there selects it, React Flow's.
  const rowBrowse = usePortRowBrowse({
    nodeId: storage.id,
    port: { displayName: label, handleId: outputHandleId },
    browse,
  });

  const rule = useRateRule({
    storage,
    role: role === "idle" ? "product" : role,
    result,
    flowing: role === "buffer" ? bufferThroughput(result) : Math.abs(result?.netPerSecond ?? 0),
  });
  const locked = rule.locked || checklistLocked();
  /** A byproduct has no rule: choosing one makes it a product first. */
  const promote = () => {
    if (role === "byproduct") setDrainMode(storage.id, "product");
  };
  const chooseRule = (next: TargetMode) => {
    promote();
    rule.choose(next);
  };
  const stepRule = (by: 1 | -1) => {
    const index = RULE_STEPS.indexOf(rule.shownMode);
    chooseRule(RULE_STEPS[(index + by + RULE_STEPS.length) % RULE_STEPS.length]!);
  };

  const [menu, setMenu] = useState<DOMRect>();
  const [context, setContext] = useState<{ x: number; y: number }>();
  const keyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [keyEl, setKeyEl] = useState<HTMLDivElement | null>(null);
  const slopDown = useRef({ x: 0, y: 0 });

  // The rule hook owns open/close; the menu hangs from the key.
  useLayoutEffect(() => {
    if (rule.open && keyRef.current) setMenu(keyRef.current.getBoundingClientRect());
    else setMenu(undefined);
  }, [rule.open]);

  useNativeWheel(keyEl, (event) => {
    if (locked || event.ctrlKey || event.deltaY === 0 || !view.hasRule || !wheelChangesValues()) return;
    event.preventDefault();
    event.stopPropagation();
    stepRule(event.deltaY > 0 ? 1 : -1);
  });
  useNativeWheel(box, (event) => {
    if (locked || !view.hasRule || event.deltaY === 0 || !wheelChangesValues()) return;
    event.preventDefault();
    event.stopPropagation();
    const up = event.deltaY < 0;
    if (!up && !rule.any) {
      // Scrolling down to under one in the shown unit clears the rate.
      const step = event.shiftKey ? 100 : event.ctrlKey || event.metaKey ? 10 : 1;
      const shown = Math.abs(rule.target ?? 0) * rateMultiplierForKind(storage.kind);
      if (Math.round(shown) - step < 1) {
        promote();
        playBoardSound("dialRate", { step: 0 });
        suppressBoardSound("adjust", 150);
        useFactoryStore.getState().setStorageTarget(storage.id, undefined);
        return;
      }
    }
    promote();
    // The mod's step: the shown figure rounded, plus 1, 10 with Ctrl or 100 with Shift.
    rule.stepRate(up, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      add: true,
    });
  });

  const middle = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (!locked) {
      promote();
      // The board's unpin sound when there was a rate to clear, claimed so its change sound does not double it.
      if (!rule.any) playEditSfx("board.unpin");
      rule.clear(event);
    }
  };
  const middleDown = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };

  const menuRows = useMemo(() => {
    const rows: Array<{
      mark: string;
      label: string;
      on: boolean;
      muted: boolean;
      run: () => void;
    }> = [];
    if (view.hasRule) {
      for (const step of RULE_STEPS) {
        rows.push({
          mark: RULE_MARK[step],
          label: RULE_NAME[step],
          on: step === rule.shownMode,
          muted: false,
          run: () => chooseRule(step),
        });
      }
    }
    // Product and trash take turns; a source and a buffer are what their wires make them.
    if (view.kind === "product" || view.kind === "trash") {
      rows.push({
        mark: "",
        label: view.kind === "trash" ? TO_PRODUCT : TO_TRASH,
        on: false,
        muted: true,
        run: () => setDrainMode(storage.id, view.kind === "trash" ? "product" : "trash"),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind, rule.shownMode, storage.id, role]);

  const pressed = (event: PointerEvent) => {
    slopDown.current = { x: event.clientX, y: event.clientY };
  };
  const wasClick = (event: MouseEvent) =>
    Math.hypot(event.clientX - slopDown.current.x, event.clientY - slopDown.current.y) < CLICK_SLOP;

  const editing = rule.editing;
  const boxProps =
    view.kind === "trash"
      ? { "data-fixed": "" }
      : view.target
        ? {
            "data-text": view.target.number,
            "data-unit": view.target.unit,
            "data-progress": view.progress !== undefined ? "" : undefined,
            "data-tone": view.tone,
            "data-unmet": view.unmet ? "" : undefined,
            style:
              view.progress !== undefined
                ? ({ "--cd-progress": view.progress } as CSSProperties)
                : undefined,
          }
        : {
            "data-text": view.boxText,
            "data-empty": "",
            "data-prompt": view.prompt ? "" : undefined,
          };
  const boxTextProps = view.kind === "trash" ? { "data-text": view.boxText } : {};

  const commit = () => {
    const had = rule.draft.trim() !== "";
    rule.commit();
    if (had) promote();
  };

  // The drawer's menu (docs/groups.md, "Menus"): a right click anywhere on it opens its rule key's rows and Delete
  // drawer, as the mod's DrawerCard does.
  const ruleRows = (close: () => void) =>
    menuRows.map((row) => (
      <MenuRow
        key={row.label}
        label={row.label}
        detail={row.mark || undefined}
        checked={row.muted ? undefined : row.on}
        onClick={() => {
          close();
          row.run();
        }}
      />
    ));

  return (
    <div
      className="cd-wrap"
      onContextMenu={(event) => {
        if (event.defaultPrevented || locked) return;
        event.preventDefault();
        event.stopPropagation();
        setContext({ x: event.clientX, y: event.clientY });
      }}
      data-storage-node-id={storage.id}
      data-storage-kind={storage.kind}
      data-storage-resource-id={storage.resourceId}
      data-spill={view.spill ? "" : undefined}
    >
      {/* Wires dock on the drawer's perimeter: both anchors span the whole drawer, the router picks the side. */}
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={inputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={outputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <div
        className="cd"
        data-node-glance-root=""
        data-kind={view.kind}
        data-selected={selected ? "" : undefined}
        data-lit={lit ? "" : undefined}
        data-unset={view.prompt ? "" : undefined}
        data-spill={view.spill ? "" : undefined}
        // The bar's tip rides the drawer: its grip (.cd::before) is the only part of it with no tip of its own.
        {...tipAttrs(view.tips.bar)}
      >
        <div
          className="cd-edge"
          data-rate={view.glanceRate}
          data-zero={view.zero ? "" : undefined}
          style={{ "--cd-chars": view.glanceRate.length } as CSSProperties}
          aria-hidden
        />
        <div className="cd-fill" aria-hidden>
          <div className="cd-bar" />
        </div>
        <DrawerIcon storage={storage} alternatives={category?.alternatives} />
        <div
          role="button"
          tabIndex={0}
          className="cd-del"
          {...tipAttrs(view.tips.del)}
          aria-label="Delete drawer"
          onPointerDownCapture={pressed}
          onClick={(event) => {
            event.stopPropagation();
            if (wasClick(event) && !locked) deleteStorage(storage.id);
          }}
        />
        {view.flip && !locked ? (
          <div
            role="button"
            tabIndex={0}
            className="cd-flip"
            {...tipAttrs(view.flip)}
            aria-label={view.flip.title}
            onPointerDownCapture={pressed}
            onClick={(event) => {
              event.stopPropagation();
              if (wasClick(event) && !rule.locked && !checklistLocked()) flipStorageSide(storage.id);
            }}
          />
        ) : null}
        <div
          className="cd-body"
          data-lit={lit ? "" : undefined}
          {...tipAttrs(view.tips.body)}
          onPointerEnter={() => {
            rowBrowse.handlers.onPointerEnter();
            if (!isWiringConnection() && !checklistLocked()) {
              setHoveredFlowScope(
                buildStorageFlowScope(useFactoryStore.getState().project, storage),
              );
            }
          }}
          onPointerLeave={() => {
            rowBrowse.handlers.onPointerLeave();
            setHoveredFlowScope(undefined);
          }}
          onPointerDown={rowBrowse.handlers.onPointerDown}
          onPointerMove={rowBrowse.handlers.onPointerMove}
          onPointerUp={rowBrowse.handlers.onPointerUp}
          onPointerCancel={rowBrowse.handlers.onPointerCancel}
          onClick={rowBrowse.handlers.onClick}
          onContextMenu={rowBrowse.handlers.onContextMenu}
        >
          {/* One grab point: typed as a source so a drag can start anywhere on it; the board runs in loose
              connection mode, so a wire coming the other way lands here too. */}
          <Handle
            id={outputHandleId}
            type="source"
            position={Position.Right}
            data-resource-handle="true"
            data-resource-node-id={storage.id}
            data-resource-handle-id={outputHandleId}
            aria-label={`${label}${readOnly ? "" : ". Drag to connect, R for recipes, U for uses"}`}
            className="nodrag"
            style={WELL_HANDLE}
          />
          <Handle
            id={inputHandleId}
            type="target"
            position={Position.Left}
            className="nodrag !pointer-events-none !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
          />
          <span
            className="cd-num"
            data-unit={view.unit}
            data-zero={view.zero ? "" : undefined}
            data-small={view.numberSmall ? "" : undefined}
          >
            {view.number}
          </span>
          <span
            className="cd-name"
            data-small={view.nameSmall || undefined}
            data-clip={view.nameClipped || undefined}
          >
            {view.label}
          </span>
          {view.hasRule || view.kind === "trash" ? (
            <div
              ref={(element) => {
                keyRef.current = element;
                setKeyEl(element);
              }}
              role="button"
              tabIndex={0}
              className="cd-key nodrag nowheel"
              data-wheel-value=""
              data-cd-key=""
              data-menu-anchor=""
              data-mark={view.ruleMark}
              data-any={view.rule === "ignore" || view.kind === "trash" ? "" : undefined}
              data-open={rule.open ? "" : undefined}
              {...tipAttrs(view.tips.rule)}
              aria-haspopup="menu"
              aria-expanded={rule.open}
              aria-label={`Rule: ${view.kind === "trash" ? "Trash" : RULE_NAME[view.rule]}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={middleDown}
              onAuxClick={middle}
              onClick={(event) => {
                event.stopPropagation();
                if (!locked) rule.setOpen(!rule.open);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!locked && view.hasRule) stepRule(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!locked) rule.setOpen(!rule.open);
                }
              }}
            />
          ) : null}
          {view.hasRule || view.kind === "trash" ? (
            <div
              ref={setBox}
              role={view.kind === "trash" ? undefined : "button"}
              tabIndex={view.kind === "trash" ? undefined : 0}
              className="cd-box nodrag nowheel"
              data-wheel-value=""
              data-editing={editing ? "" : undefined}
              {...(view.kind === "trash" ? tipAttrs(view.tips.body) : tipAttrs(view.tips.rate))}
              aria-label={
                view.target
                  ? `Your rate: ${view.target.number} ${view.target.unit}`
                  : "Your rate: none"
              }
              {...(editing ? {} : boxProps)}
              {...(editing ? {} : boxTextProps)}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={middleDown}
              onAuxClick={middle}
              onClick={(event) => {
                event.stopPropagation();
                if (view.kind === "trash" || locked || editing) return;
                rule.beginEdit(rule.any ? undefined : rule.target);
              }}
              onContextMenu={(event) => {
                // Not the item's: the box is the drawer's menu, as the rest of the drawer outside the item is.
                if (event.defaultPrevented || locked) return;
                event.preventDefault();
                event.stopPropagation();
                setContext({ x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (
                  view.kind !== "trash" &&
                  !editing &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  rule.beginEdit(rule.any ? undefined : rule.target);
                }
              }}
            >
              {editing ? <RateField rule={rule} onCommit={commit} /> : null}
            </div>
          ) : null}
        </div>
        {view.spill ? (
          <div
            className="cd-forced"
            data-lit={spillLit ? "" : undefined}
            {...tipAttrs(view.spill.tip)}
            onPointerEnter={() => setSpillHover(storage.id)}
            onPointerLeave={() => setSpillHover(undefined)}
          >
            <span className="cd-forced-num" data-unit={view.spill.unit}>
              {view.spill.number}
            </span>
            <span className="cd-forced-name">Forced out</span>
          </div>
        ) : null}
        {rowBrowse.menu}
      </div>
      {menu ? (
        <BoardMenu
          x={menu.left}
          y={menu.bottom + 2}
          label="Rule"
          width={210}
          onClose={() => rule.setOpen(false)}
        >
          {ruleRows(() => rule.setOpen(false))}
        </BoardMenu>
      ) : null}
      {context ? (
        <BoardMenu x={context.x} y={context.y} label="Drawer" onClose={() => setContext(undefined)}>
          {ruleRows(() => setContext(undefined))}
          {menuRows.length > 0 ? <MenuLine /> : null}
          <MenuRow
            label="Delete drawer"
            danger
            onClick={() => {
              setContext(undefined);
              deleteStorage(storage.id);
            }}
          />
        </BoardMenu>
      ) : null}
    </div>
  );
}

/** The rate box while it is typed into: a number, `2.5k`, `1M` or `1/3` in the board's unit. */
function RateField({ rule, onCommit }: { rule: RateRule; onCommit: () => void }) {
  return (
    <input
      autoFocus
      value={rule.draft}
      inputMode="text"
      aria-label="Your rate"
      placeholder="rate"
      className="nodrag"
      onChange={(event) => rule.setDraft(event.target.value)}
      onBlur={onCommit}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") rule.cancelEdit();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && !rule.any && !rule.locked) playEditSfx("board.unpin");
        rule.clear(event);
      }}
    />
  );
}

/**
 * The drawer's look alone, for the void-drop ghost: the exact drawer a release would spawn, no handles and no
 * controls.
 */
export function CleanDrawerFace({
  storage,
  role,
  net = 0,
}: {
  storage: FactoryStorage;
  role: StorageRole;
  net?: number;
}) {
  const category = useFactoryStore((state) =>
    getCategoryPresentation(state.project.recipes, storage.kind, storage.resourceId),
  );
  const label = resourceLabel(
    category ?? { id: storage.resourceId, displayName: storage.displayName },
  );
  useFontEpoch();
  const view = buildDrawerView({
    storage,
    role,
    label,
    result: { netPerSecond: net } as never,
    unanchored: false,
    unmet: false,
    linked: true,
  });
  return (
    <div className="cd" data-kind={view.kind}>
      <div className="cd-edge" aria-hidden />
      <div className="cd-fill" aria-hidden>
        <div className="cd-bar" />
      </div>
      <div className="cd-body">
        <DrawerIcon storage={storage} alternatives={category?.alternatives} />
        <span className="cd-num" data-unit={view.unit} data-zero="">
          {view.number}
        </span>
        <span className="cd-name">{view.label}</span>
        {view.hasRule || view.kind === "trash" ? (
          <>
            <div className="cd-key" data-mark={view.ruleMark} data-any="" />
            <div
              className="cd-box"
              data-text={view.boxText}
              data-empty=""
              data-fixed={view.kind === "trash" ? "" : undefined}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
