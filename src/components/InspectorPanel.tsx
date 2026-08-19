"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MachineShoppingList } from "./MachineShoppingList";
import { formatCompact } from "@/lib/model";
import { makeResourceKey } from "@/lib/model/resources";
import { getStorageRoles } from "@/lib/model/storage-role";
import { rateUnitMultiplier, rateUnitSuffix } from "@/lib/model/rate-unit";
import type {
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
  ResourceKey,
} from "@/lib/model/types";
import { calculateSelectionFlow, selectInternalBalances } from "@/lib/solver";
import { selectTrendSeries, useResourceTrends } from "@/lib/resource-trends";
import { useFactoryStore } from "@/store/factory-store";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  toggleResourceFavourite,
  toggleResourceHidden,
  useWorkspaceView,
  writeWorkspaceView,
} from "@/lib/workspace-view";
import {
  applyNetFlow,
  applyResourceMarks,
  buildFlowRows,
  filterFlowBalances,
  findResourceCardIds,
  findRowIndexAtOffset,
  getFlowRowValue,
  measureFlowRows,
  type FlowRow,
  type FlowSection,
  type FlowSectionId,
  type FlowSectionTone,
  type ResourceMarks,
} from "./inspector/flow-sections";
import { TrendSparkline } from "./inspector/TrendSparkline";
import { MotionNumberText, runMotionTween, useBoardMotion } from "./flow/board-motion";
import { ResourceIcon } from "./nei/ResourceIcon";

const FLOW_FILTER_DEBOUNCE_MS = 120;
const SELECTION_DEBOUNCE_MS = 100;

// A row cannot be shorter than its icon, so row height and icon size are one
// decision, not two: the icon fills the row edge to edge with no padding, which is
// what makes consecutive rows butt up with no band between them. Both the icon
// column and the icon box are derived from ROW_HEIGHTS.item rather than restated
// as a utility class, so the two can never drift apart. This is the single lever
// for how many resources fit on screen.
const ROW_HEIGHTS = { header: 24, item: 30, empty: 24, chart: 60 };
const ICON_COLUMN = `${ROW_HEIGHTS.item}px`;
const ROW_OVERSCAN = 6;
/** Stable identity so the row memo holds when charts are switched off. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/**
 * Rates here obey the board's /s /min /hr switch like every other surface.
 * The unit is a module singleton and the store re-solves when it changes, so
 * these read the live setting at render with nothing to thread through.
 */
function formatRateValue(perSecond: number): string {
  return formatCompact(perSecond * rateUnitMultiplier());
}

function rateUnitFor(kind: ResourceBalance["kind"]): string {
  return rateUnitSuffix(kind === "fluid").trim();
}

/** How long a row takes to grow into the list or fold out of it. */
const PRESENCE_MS = 240;
/**
 * Past this many rows changing at once (a tab switch, a filter keystroke, a
 * RAW/NET flip) the list snaps: forty rows folding in a wave is churn, not
 * information.
 */
const PRESENCE_BULK_CAP = 16;

interface RowPresence {
  /** Target rows plus any rows still folding out, held in place. */
  rows: FlowRow[];
  /** Bumped every animation frame; put it in measure-memo deps. */
  version: number;
  /** Height/opacity scale for one row: 1 settled, 0..1 mid-fold. */
  factorFor: (row: FlowRow) => number;
}

/**
 * List membership, animated: a row that joins the list grows from nothing
 * and a row that leaves folds away instead of popping, on the same
 * value-motion clock as the numbers. The windowing stays exact throughout
 * because measureFlowRows reads the animated heights through `factorFor`.
 *
 * Rows are reconciled by KEY in the render phase (idempotent for a repeated
 * target), so the first frame after a change already shows arrivals at
 * height zero — an effect-only start would flash them full-size first. The
 * tweens themselves start from an effect; a render React throws away starts
 * nothing.
 */
function useRowPresence(targetRows: FlowRow[], enabled: boolean): RowPresence {
  const [, force] = useReducer((count: number) => count + 1, 0);
  const stateRef = useRef<
    | {
        target: FlowRow[];
        display: FlowRow[];
        factors: Map<string, number>;
        /** Where each animating key is heading: 1 arriving, 0 leaving. */
        directions: Map<string, 0 | 1>;
        cancels: Map<string, () => void>;
        pendingEnters: string[];
        pendingLeaves: string[];
        pendingSnap: boolean;
        seq: number;
        version: number;
      }
    | undefined
  >(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = {
      target: targetRows,
      display: targetRows,
      factors: new Map(),
      directions: new Map(),
      cancels: new Map(),
      pendingEnters: [],
      pendingLeaves: [],
      pendingSnap: false,
      seq: 0,
      version: 0,
    };
  }
  const state = stateRef.current;

  if (state.target !== targetRows) {
    const targetKeys = new Set(targetRows.map((row) => row.key));
    const displayedKeys = new Set(state.display.map((row) => row.key));
    const arrivals: string[] = [];
    for (const row of targetRows) {
      // New to the list, or caught on the way out and coming back.
      if (!displayedKeys.has(row.key) || state.directions.get(row.key) === 0) {
        arrivals.push(row.key);
      }
    }
    const leavers = state.display.filter(
      (row) => !targetKeys.has(row.key) && state.directions.get(row.key) !== 0,
    );
    const churn = arrivals.length + leavers.length;

    if (!enabled || churn > PRESENCE_BULK_CAP) {
      state.display = targetRows;
      state.pendingEnters = [];
      state.pendingLeaves = [];
      if (churn > 0 || state.factors.size > 0) {
        state.pendingSnap = true;
        state.seq += 1;
      }
      state.version += 1;
    } else if (churn === 0 && state.factors.size === 0) {
      // Same membership, fresh data: pass the new rows straight through.
      state.display = targetRows;
    } else {
      // Merge: survivors take their fresh target row (in target order),
      // leavers hold their old row and their old place while they fold.
      const display: FlowRow[] = [];
      let cursor = 0;
      for (const row of state.display) {
        if (targetKeys.has(row.key)) {
          while (cursor < targetRows.length) {
            const next = targetRows[cursor];
            cursor += 1;
            display.push(next);
            if (next.key === row.key) {
              break;
            }
          }
        } else {
          display.push(row);
        }
      }
      while (cursor < targetRows.length) {
        display.push(targetRows[cursor]);
        cursor += 1;
      }
      state.display = display;
      for (const key of arrivals) {
        if (!state.factors.has(key)) {
          state.factors.set(key, 0);
        }
        state.pendingEnters.push(key);
      }
      for (const row of leavers) {
        state.pendingLeaves.push(row.key);
      }
      if (churn > 0) {
        state.seq += 1;
      }
      state.version += 1;
    }
    state.target = targetRows;
  }

  const seq = state.seq;
  useEffect(() => {
    const shared = stateRef.current;
    if (!shared) {
      return;
    }
    if (shared.pendingSnap) {
      for (const cancel of shared.cancels.values()) {
        cancel();
      }
      shared.cancels.clear();
      shared.factors.clear();
      shared.directions.clear();
      shared.pendingSnap = false;
      shared.version += 1;
      force();
    }
    const animateKey = (key: string, to: 0 | 1) => {
      shared.cancels.get(key)?.();
      const from = shared.factors.get(key) ?? (to === 1 ? 0 : 1);
      shared.directions.set(key, to);
      const cancel = runMotionTween({
        durationMs: PRESENCE_MS,
        onFrame: (eased) => {
          shared.factors.set(key, from + (to - from) * eased);
          shared.version += 1;
          force();
        },
        onDone: () => {
          shared.cancels.delete(key);
          shared.directions.delete(key);
          shared.factors.delete(key);
          if (to === 0) {
            shared.display = shared.display.filter((row) => row.key !== key);
          }
          shared.version += 1;
          force();
        },
      });
      shared.cancels.set(key, cancel);
    };
    const enters = shared.pendingEnters;
    shared.pendingEnters = [];
    const leaves = shared.pendingLeaves;
    shared.pendingLeaves = [];
    for (const key of enters) {
      animateKey(key, 1);
    }
    for (const key of leaves) {
      animateKey(key, 0);
    }
    // The ref box is stable; a new seq is a new batch of arrivals/leavers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  useEffect(
    () => () => {
      for (const cancel of stateRef.current?.cancels.values() ?? []) {
        cancel();
      }
    },
    [],
  );

  return {
    rows: state.display,
    version: state.version,
    factorFor: (row) => state.factors.get(row.key) ?? 1,
  };
}

export function InspectorPanel() {
  return (
    <aside
      data-help-anchor="inspector"
      className="flex h-full min-h-[360px] compact:min-h-0 flex-col bg-surface"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <FlowIOPanel />
      </div>
      {/* The build list rides the panel's floor: what to build, at which
          tier, and what one of each draws. */}
      <MachineShoppingList />
    </aside>
  );
}

function FlowIOPanel() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const setHoveredFlowResourceKey = useFactoryStore((state) => state.setHoveredFlowResourceKey);
  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);

  const [filter, setFilter] = useState("");
  // Internal starts folded: it is the long tail, and the group that means
  // "nothing to see". One click opens it, and the state is per visit like the
  // other folds.
  const [collapsed, setCollapsed] = useState<Record<FlowSectionId, boolean>>({
    need: false,
    output: false,
    internal: true,
  });

  const resourcesByKey = useMemo(() => buildProjectResourceLookup(project), [project]);
  // Hundreds of rows carrying resource icons, so the list follows the settled
  // filter. The input stays on the raw value and remains instant.
  const debouncedFilter = useDebouncedValue(filter, FLOW_FILTER_DEBOUNCE_MS);

  // Selecting cards narrows the whole panel to those cards, solved as their
  // own little plan. Selecting nothing (or nothing but drawers) shows the
  // board.
  //
  // Debounced because this is a real solve, and dragging a selection box over
  // a large board changes the membership many times on the way. The lag is
  // imperceptible on a click and keeps a box drag from re-solving per frame.
  // Keyed on the joined ids so a re-selection of the same cards is free.
  const selectionKey = selectedBoardIds.join("\0");
  const debouncedSelectionKey = useDebouncedValue(selectionKey, SELECTION_DEBOUNCE_MS);
  const selection = useMemo(
    () =>
      calculateSelectionFlow(
        project,
        debouncedSelectionKey === "" ? [] : debouncedSelectionKey.split("\0"),
      ),
    [project, debouncedSelectionKey],
  );

  const planInternal = useMemo(
    () => selectInternalBalances(Object.values(result.resources)),
    [result.resources],
  );
  const scope = selection ?? result;
  const balanced = selection ? selection.internal : planInternal;

  const workspace = useWorkspaceView();
  const marks = useMemo<ResourceMarks>(
    () => ({
      hidden: new Set(workspace.hiddenResourceKeys),
      favourites: new Set(workspace.favouriteResourceKeys),
      showHidden: workspace.showHiddenResources,
      favouritesOnly: workspace.favouritesOnly,
    }),
    [
      workspace.favouriteResourceKeys,
      workspace.favouritesOnly,
      workspace.hiddenResourceKeys,
      workspace.showHiddenResources,
    ],
  );

  // Charted resources come from the plan's own books, so a starred resource
  // that has left the board stops being charted rather than lingering at a
  // stale value.
  const favourites = useMemo(() => {
    const byKey = new Map<string, ResourceBalance>();
    for (const balance of Object.values(scope.resources)) {
      if (marks.favourites.has(balance.key)) {
        byKey.set(balance.key, balance);
      }
    }
    // Ordered by the saved list so the charts hold still as values move.
    return workspace.favouriteResourceKeys
      .map((key) => byKey.get(key))
      .filter((balance): balance is ResourceBalance => balance !== undefined);
  }, [marks.favourites, scope.resources, workspace.favouriteResourceKeys]);

  // Declared boundary: which resources have a drawer whose JOB is importing
  // or exporting. A source, product or byproduct drawer is the plan saying
  // "this comes in" / "this goes out", and that statement does not stop being
  // true when the rate hits zero — so those rows stay listed at 0/s instead
  // of vanishing, and only the number moves. Internal rows keep coming and
  // going with the wiring, which is what the presence animation is for.
  const boundaryStorageKeys = useMemo(() => {
    const roles = getStorageRoles(project);
    const sources = new Set<ResourceKey>();
    const drains = new Set<ResourceKey>();
    for (const storage of project.storages ?? []) {
      const key = makeResourceKey(storage.kind, storage.resourceId);
      const role = roles.get(storage.id);
      if (role === "source") {
        sources.add(key);
      } else if (role === "product" || role === "byproduct") {
        drains.add(key);
      }
    }
    return { sources, drains };
  }, [project]);

  const sections = useMemo<FlowSection[]>(() => {
    const build = (
      id: FlowSectionId,
      label: string,
      empty: string,
      tone: FlowSectionTone,
      sign: -1 | 0 | 1,
      items: ResourceBalance[],
    ): FlowSection => {
      const marked = applyResourceMarks(items, marks);
      return {
        id,
        label,
        empty,
        tone,
        sign,
        items: filterFlowBalances(marked, debouncedFilter),
        totalCount: marked.length,
      };
    };

    // The headings carry no explanatory line beside them. Three words the user
    // reads once and then knows; the glosses were permanent lines of text
    // earning nothing after the first day.
    //
    // NET collapses any item sitting on both sides of the boundary into one
    // signed figure before the marks and the filter see it, so the count
    // badges and the star float always describe the list actually drawn.
    let boundary = workspace.netFlowRates
      ? applyNetFlow(scope.externalInputs, scope.unconsumedOutputs)
      : { needs: scope.externalInputs, outputs: scope.unconsumedOutputs };
    // The declared boundary (see boundaryStorageKeys): rows the drawers vouch
    // for join at 0/s when the books dropped them. Board scope only — the
    // selection view is a transient analysis, not the plan's ledger. In NET
    // mode a resource already listed on EITHER side stays where the sign put
    // it rather than gaining a zero twin.
    if (!selection) {
      const listedEitherSide = workspace.netFlowRates
        ? new Set([...boundary.needs, ...boundary.outputs].map((balance) => balance.key))
        : undefined;
      const augment = (list: ResourceBalance[], keys: ReadonlySet<ResourceKey>) => {
        const present = listedEitherSide ?? new Set(list.map((balance) => balance.key));
        const extras: ResourceBalance[] = [];
        for (const key of keys) {
          const balance = scope.resources[key];
          if (!present.has(key) && balance) {
            extras.push(balance);
          }
        }
        if (extras.length === 0) {
          return list;
        }
        extras.sort((a, b) =>
          (a.displayName ?? a.resourceId).localeCompare(b.displayName ?? b.resourceId),
        );
        return [...list, ...extras];
      };
      boundary = {
        needs: augment(boundary.needs, boundaryStorageKeys.sources),
        outputs: augment(boundary.outputs, boundaryStorageKeys.drains),
      };
    }
    return [
      // One line each: the row is a single fixed-height line, so wrapping
      // would clip.
      build("need", "Inputs", "Nothing missing.", "need", -1, boundary.needs),
      build("output", "Outputs", "Nothing coming out yet.", "output", 1, boundary.outputs),
      build("internal", "Internal", "Nothing internal.", "internal", 0, balanced),
    ];
  }, [
    balanced,
    boundaryStorageKeys,
    debouncedFilter,
    marks,
    scope.externalInputs,
    scope.resources,
    scope.unconsumedOutputs,
    selection,
    workspace.netFlowRates,
  ]);

  const toggleSection = useCallback((id: FlowSectionId) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  /**
   * Double-click flies the board to a card that uses this resource, and doing
   * it again steps to the next one. The step counter is per resource and lives
   * in a ref rather than state: advancing it must not re-render the list, and
   * it is read only at the moment of the click.
   */
  const focusStepRef = useRef(new Map<string, number>());
  const focusBoardOnResource = useCallback(
    (resourceKey: string) => {
      const cardIds = findResourceCardIds(project, resourceKey);
      if (cardIds.length === 0) {
        return;
      }
      const step = focusStepRef.current.get(resourceKey) ?? 0;
      focusStepRef.current.set(resourceKey, step + 1);
      focusBoardNode(cardIds[step % cardIds.length]);
    },
    [focusBoardNode, project],
  );

  const activeResourceKey = hoveredFlowResourceKey;
  const matchCount = sections.reduce((total, section) => total + section.items.length, 0);
  const isFiltered = debouncedFilter.trim().length > 0;
  // Counted against the plan's own books, so resources hidden on some other
  // design never inflate the badge here.
  const hiddenCount = useMemo(
    () =>
      Object.keys(scope.resources).filter((key) => marks.hidden.has(key)).length,
    [marks.hidden, scope.resources],
  );

  return (
    <section
      className={[
        // The purple ring wraps the WHOLE panel, not just the strip: the point
        // is that everything below is about the selection, so the mode has to
        // be readable from anywhere in the list rather than only at the top.
        "flex min-h-0 flex-1 flex-col rounded border bg-surface-raised",
        selection ? "border-purple-500 ring-1 ring-purple-500/60" : "border-line",
      ].join(" ")}
    >
      {selection ? (
        <ScopeStrip
          machineCount={selection.machineCount}
          storageCount={selection.storageCount}
        />
      ) : null}

      <div className="shrink-0 border-b border-line p-1">
        <div className="mb-1 flex items-center gap-1">
          <ToolbarToggle
            on={workspace.showHiddenResources}
            onClick={() =>
              writeWorkspaceView({ showHiddenResources: !workspace.showHiddenResources })
            }
            title={
              workspace.showHiddenResources
                ? "Hidden resources are showing, greyed out. Click to drop them from the list."
                : "Show hidden resources, greyed out, so you can unhide them."
            }
            label={
              workspace.showHiddenResources
                ? "Stop showing hidden resources"
                : "Show hidden resources"
            }
            tone="cyan"
          >
            {workspace.showHiddenResources ? <EyeIcon /> : <EyeOffIcon />}
          </ToolbarToggle>

          {/*
            Charts are whole-plan only, so they go away while a selection is
            scoping the panel. There is no such thing as this resource's
            history "within the selection" - the record is one running story of
            the board, and re-cutting it per selection would mean keeping a
            separate history for every subset anyone might ever pick.
          */}
          {selection ? null : (
            <ToolbarToggle
              on={workspace.trendsOpen}
              onClick={() => writeWorkspaceView({ trendsOpen: !workspace.trendsOpen })}
              title={
                workspace.trendsOpen
                  ? "Hide the charts under starred resources."
                  : "Show a chart under every starred resource."
              }
              label={workspace.trendsOpen ? "Hide all charts" : "Show all charts"}
              tone="amber"
            >
              <ChartIcon />
            </ToolbarToggle>
          )}

          <ToolbarToggle
            on={workspace.favouritesOnly}
            onClick={() => writeWorkspaceView({ favouritesOnly: !workspace.favouritesOnly })}
            title={
              workspace.favouritesOnly
                ? "Only starred resources are listed. Click to list everything again."
                : "List only the resources you have starred."
            }
            label={
              workspace.favouritesOnly ? "List every resource again" : "List only starred resources"
            }
            tone="amber"
          >
            <span className="text-[13px] leading-none">★</span>
          </ToolbarToggle>

          {/* RAW against NET, both words always up: a reader who has never met
              the distinction can see there is one and read both answers before
              clicking anything - the same rule the drawer mode swap follows.
              Panel arithmetic, not wiring: an item never moves on the board
              because of this switch. */}
          <div
            role="group"
            aria-label="Rate display"
            className="flex h-6 shrink-0 overflow-hidden rounded border border-line-strong"
          >
            <button
              type="button"
              onClick={() => writeWorkspaceView({ netFlowRates: false })}
              title="Both sides, as they are."
              aria-label="Show raw rates"
              aria-pressed={!workspace.netFlowRates}
              className={[
                "px-1.5 text-[9px] font-black leading-none tracking-tight",
                workspace.netFlowRates
                  ? "text-fg-muted hover:text-fg"
                  : "bg-cyan-500/20 text-cyan-200",
              ].join(" ")}
            >
              RAW
            </button>
            <button
              type="button"
              onClick={() => writeWorkspaceView({ netFlowRates: true })}
              title="Outputs minus inputs."
              aria-label="Show net rates"
              aria-pressed={workspace.netFlowRates}
              className={[
                "border-l border-line-strong px-1.5 text-[9px] font-black leading-none tracking-tight",
                workspace.netFlowRates
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              NET
            </button>
          </div>

          {hiddenCount > 0 ? (
            <span
              className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-muted"
              title={`${hiddenCount} resource${hiddenCount === 1 ? "" : "s"} hidden`}
            >
              {hiddenCount} hidden
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => writeWorkspaceView({ rightPanelOpen: false })}
            title="Hide this column"
            aria-label="Hide the resources column"
            className={[
              "flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line-strong text-fg-muted hover:border-cyan-600 hover:text-cyan-400",
              hiddenCount > 0 ? "" : "ml-auto",
            ].join(" ")}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        </div>

        <div className="relative">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter resources…"
            aria-label="Filter flow resources"
            className="h-9 w-full rounded border border-line-strong bg-surface pl-2 pr-14 text-base text-fg outline-none placeholder:text-fg-muted focus:border-cyan-600 focus:ring-1 focus:ring-cyan-300"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted hover:bg-surface-sunken hover:text-fg"
            >
              {matchCount} ✕
            </button>
          ) : null}
        </div>
      </div>

      <FlowVirtualList
        sections={sections}
        collapsed={collapsed}
        isFiltered={isFiltered}
        resourcesByKey={resourcesByKey}
        activeResourceKey={activeResourceKey}
        hidden={marks.hidden}
        favourites={marks.favourites}
        // Charts are a whole-plan record, so a scoped panel has none to show.
        showCharts={workspace.trendsOpen && !selection}
        manageMode={workspace.showHiddenResources}
        onToggleSection={toggleSection}
        onHover={setHoveredFlowResourceKey}
        onFocusBoard={focusBoardOnResource}
      />
    </section>
  );
}

/** One square button in the panel's toolbar row. */
function ToolbarToggle({
  on,
  onClick,
  title,
  label,
  tone,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  label: string;
  tone: "cyan" | "amber";
  children: React.ReactNode;
}) {
  const onStyle =
    tone === "cyan"
      ? "border-cyan-500 bg-cyan-500/20 text-cyan-200"
      : "border-amber-500 bg-amber-500/20 text-amber-200";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={on}
      className={[
        "flex h-6 w-7 shrink-0 items-center justify-center rounded border",
        on ? onStyle : "border-line-strong text-fg-muted hover:border-line-strong hover:text-fg",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 11.5 5 7l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="1.9" />
      <path d="M2 14 14 2" />
    </svg>
  );
}

/**
 * Names the mode the purple ring is announcing. Without it the numbers change
 * under the user with no explanation the moment they drag a selection box.
 * There is no way out of the mode here on purpose: the selection belongs to
 * the board, and clicking the canvas is already how you drop it.
 */
function ScopeStrip({
  machineCount,
  storageCount,
}: {
  machineCount: number;
  storageCount: number;
}) {
  const parts = [`${machineCount} ${machineCount === 1 ? "machine" : "machines"}`];
  if (storageCount > 0) {
    parts.push(`${storageCount} ${storageCount === 1 ? "drawer" : "drawers"}`);
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-purple-500/50 bg-purple-500/20 px-2 py-1">
      <span className="text-xs font-bold uppercase tracking-wider text-purple-200">Selection</span>
      <span className="ml-auto truncate text-xs text-purple-100/70">{parts.join(", ")}</span>
    </div>
  );
}

/**
 * Windowed list over all three sections at once.
 *
 * Rendering is windowed rather than paged so a plan with hundreds of resources
 * costs the same as one with ten, while still scrolling as a single continuous
 * list. Rows stay in normal flow between two spacers — that is what lets the
 * section headers use real CSS stickiness instead of hand-positioned overlays.
 */
function FlowVirtualList({
  sections,
  collapsed,
  isFiltered,
  resourcesByKey,
  activeResourceKey,
  hidden,
  favourites,
  showCharts,
  manageMode,
  onToggleSection,
  onHover,
  onFocusBoard,
}: {
  sections: FlowSection[];
  collapsed: Record<FlowSectionId, boolean>;
  isFiltered: boolean;
  resourcesByKey: Map<string, FlowResourceDisplay>;
  activeResourceKey?: string;
  hidden: ReadonlySet<string>;
  favourites: ReadonlySet<string>;
  showCharts: boolean;
  manageMode: boolean;
  onToggleSection: (id: FlowSectionId) => void;
  onHover: (resourceKey?: string) => void;
  onFocusBoard: (resourceKey: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  // No chart rows at all when charts are off, so the list closes up rather
  // than leaving gaps where they were.
  const targetRows = useMemo(
    () => buildFlowRows(sections, collapsed, showCharts ? favourites : EMPTY_KEYS),
    [collapsed, favourites, sections, showCharts],
  );
  // Membership rides the value-motion clock: rows grow in and fold out, and
  // `rows` below may briefly hold departed rows mid-fold.
  const { valueMotion } = useBoardMotion();
  const presence = useRowPresence(targetRows, valueMotion);
  const rows = presence.rows;
  const history = useResourceTrends();
  // The pointed-at row, redrawn wide enough for its full name. Kept here
  // rather than in the row so only one can ever be open, and so it can be
  // rendered outside the scroll box that would otherwise clip it.
  const [expanded, setExpandedState] = useState<{
    key: string;
    top: number;
    right: number;
    startWidth: number;
  }>();
  const setExpanded = useCallback(
    (key: string, top: number, right: number, startWidth: number) => {
      setExpandedState({ key, top, right, startWidth });
    },
    [],
  );
  /**
   * Starring or hiding from the wide copy has to close it.
   *
   * Both marks change what the row is: a star adds a chart under it, a hide
   * can drop it from the list entirely. Leaving the copy up meant it re-rendered
   * around a pointer that had not moved, so the button under the cursor became
   * a different button - unstar, and the pointer was suddenly over Hide.
   */
  const dismissExpanded = useCallback(() => setExpandedState(undefined), []);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const expandedRow = useMemo(() => {
    if (!expanded) {
      return undefined;
    }
    for (const section of sections) {
      const balance = section.items.find((entry) => entry.key === expanded.key);
      if (balance) {
        return {
          balance,
          section,
          top: expanded.top,
          right: expanded.right,
          startWidth: expanded.startWidth,
        };
      }
    }
    // The row scrolled out from under the pointer, or a solve dropped it.
    return undefined;
  }, [expanded, sections]);
  // presence.version is what re-measures per animation frame, so the
  // spacers and the scroll length track the folding rows exactly.
  const presenceVersion = presence.version;
  const { offsets, totalHeight } = useMemo(
    () => measureFlowRows(rows, ROW_HEIGHTS, presence.factorFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, presenceVersion],
  );

  /**
   * Glue the wide copy to the row it covers.
   *
   * The numbers captured when the pointer arrived are right for that instant and
   * for nothing after it: the list scrolls, the window scrolls (the app shell
   * carries a minimum height, so a short window scrolls the whole page), a resize
   * moves the panel. The copy is `position: fixed` and stays where it was put, so
   * every one of those left it sitting beside its row instead of over it. This
   * re-measures the real row and writes the position straight to the element —
   * imperatively, so a scroll costs one measurement rather than a re-render.
   */
  const expandedKey = expandedRow?.balance.key;
  /**
   * The real row behind the copy.
   *
   * Walked rather than selected by attribute value: a resource key is full of
   * colons and the odd `@`, and only some of the list is rendered at a time, so
   * this is a handful of nodes either way.
   */
  const findExpandedRow = useCallback(() => {
    const rendered = scrollRef.current?.querySelectorAll<HTMLElement>("[data-resource-row]");
    return rendered
      ? Array.from(rendered).find((element) => element.dataset.resourceRow === expandedKey)
      : undefined;
  }, [expandedKey]);

  const positionExpanded = useCallback(() => {
    const overlay = overlayRef.current;
    const row = findExpandedRow();
    if (!overlay || !expandedKey || !row) {
      return;
    }

    const box = row.getBoundingClientRect();
    const list = scrollRef.current?.getBoundingClientRect();
    // A row scrolled half out of the list is clipped to a sliver, while its copy
    // is not: drawn on the row's real position it hung out of the bottom of the
    // panel and over the board, which looks like the wrong row entirely. No copy
    // until the row it belongs to is all there.
    if (list && (box.top < list.top - 1 || box.bottom > list.bottom + 1)) {
      overlay.style.visibility = "hidden";
      return;
    }
    overlay.style.visibility = "";
    overlay.style.top = `${box.top}px`;
    // clientWidth, not innerWidth: innerWidth counts the width of a classic
    // scrollbar and the `right` of a fixed element is measured from the initial
    // containing block, which does not. That difference is what let the row
    // underneath peek out down one side of its own copy. Flush with the row on
    // purpose: an inset "for the scrollbar" left the row's lit edge showing
    // beside its own copy, which read as a second row. The scrollbar problem
    // is solved by the copy being a pointer GHOST instead — see the wrapper.
    overlay.style.right = `${document.documentElement.clientWidth - box.right}px`;
  }, [expandedKey, findExpandedRow]);

  /**
   * How wide the copy needs to be: enough for the whole name, the rate, and the
   * room the mark buttons open in front of the rate — and never narrower than the
   * row it covers, nor wider than the window has left.
   *
   * Every copy used to be 420px, so every row slid the same distance sideways
   * whether it needed one pixel or a hundred. `max-content` asks the row itself,
   * which counts the untruncated name and the buttons' gap; a name that already
   * fits comes back no wider than its row and nothing moves.
   */
  const sizeExpanded = useCallback(() => {
    const overlay = overlayRef.current;
    const row = findExpandedRow();
    if (!overlay || !row) {
      return;
    }

    const box = row.getBoundingClientRect();
    // Measured with the arrival animations frozen. The gap the buttons slide into
    // animates up from zero width, and a measurement taken mid-flight comes back
    // short by exactly the room they are going to need. Lifting the freeze starts
    // both animations over, which is what should happen: they belong to the copy
    // arriving, and it has not been painted yet.
    overlay.classList.add("resource-row-measuring");
    overlay.style.width = "max-content";
    // Fractional measurement plus slack, never offsetWidth: that rounds to
    // whole pixels, and a round-down of a fractional max-content re-trims
    // the name to "…" — the whole point of the copy is that it never does.
    const natural = Math.ceil(overlay.getBoundingClientRect().width) + 2;
    overlay.style.width = `${Math.round(
      Math.min(Math.max(natural, box.width), Math.max(box.right - 12, box.width)),
    )}px`;
    overlay.classList.remove("resource-row-measuring");
  }, [findExpandedRow]);

  useLayoutEffect(() => {
    if (!expandedKey) {
      return undefined;
    }

    sizeExpanded();
    positionExpanded();
    // Capture phase: a scroll event does not bubble, and the one that matters
    // most is the list's own.
    window.addEventListener("scroll", positionExpanded, true);
    window.addEventListener("resize", positionExpanded);
    return () => {
      window.removeEventListener("scroll", positionExpanded, true);
      window.removeEventListener("resize", positionExpanded);
    };
  }, [expandedKey, positionExpanded, sizeExpanded]);

  /**
   * Dismissal, watched from the document: the copy is pointer-transparent,
   * so it cannot see the pointer leave it. While one is up, the pointer is
   * either on a list row (rows keep or replace the copy themselves), on the
   * copy's own box (reading the overhang, or on its mark buttons), or it has
   * moved on — board, headers, filter box — and the copy folds. There is
   * deliberately NO carve-out near the scrollbar: the ghost already lets the
   * bar be grabbed through it, and an early fold there dropped the copy
   * exactly while the pointer travelled toward the star and eye.
   */
  useEffect(() => {
    if (!expandedKey) {
      return undefined;
    }
    const onMove = (event: globalThis.MouseEvent) => {
      const overlay = overlayRef.current;
      const target = event.target;
      if (target instanceof Element && overlay?.contains(target)) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest("[data-resource-row], [data-resource-chart]")
      ) {
        return;
      }
      const copy = overlay?.getBoundingClientRect();
      if (
        copy &&
        event.clientX >= copy.left &&
        event.clientX <= copy.right &&
        event.clientY >= copy.top &&
        event.clientY <= copy.bottom
      ) {
        return;
      }
      setExpandedState(undefined);
    };
    document.addEventListener("mousemove", onMove, { capture: true, passive: true });
    return () => document.removeEventListener("mousemove", onMove, { capture: true });
  }, [expandedKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const startIndex = Math.max(0, findRowIndexAtOffset(offsets, scrollTop) - ROW_OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    findRowIndexAtOffset(offsets, scrollTop + viewportHeight) + 1 + ROW_OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  // The header of the section being scrolled through may sit above the window.
  // Re-adding it keeps a header pinned at all times; its height comes back out
  // of the top spacer so the total scroll length is unchanged.
  let stickyHeader: FlowRow | undefined;
  for (let index = startIndex; index >= 0; index -= 1) {
    if (rows[index]?.type === "header") {
      stickyHeader = index < startIndex ? rows[index] : undefined;
      break;
    }
  }

  const topSpacer = Math.max(0, offsets[startIndex] - (stickyHeader ? ROW_HEIGHTS.header : 0));
  const bottomSpacer = Math.max(0, totalHeight - offsets[endIndex]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {stickyHeader?.type === "header" ? (
        <FlowSectionHeader
          section={stickyHeader.section}
          collapsed={stickyHeader.collapsed}
          isFiltered={isFiltered}
          onToggle={onToggleSection}
        />
      ) : null}

      <div style={{ height: topSpacer }} />

      {visibleRows.map((row) => {
        // Headers are never wrapped: they are permanent (only their sections'
        // CONTENTS churn), and the shell would cage their sticky pinning.
        if (row.type === "header") {
          return (
            <FlowSectionHeader
              key={row.key}
              section={row.section}
              collapsed={row.collapsed}
              isFiltered={isFiltered}
              onToggle={onToggleSection}
            />
          );
        }

        // Every other row lives in a presence shell: full height at rest, a
        // clipping box mid-fold. Always mounted so an animation starting is
        // a style change, never a remount.
        const factor = presence.factorFor(row);
        const shell = (content: ReactNode) => (
          <div
            key={row.key}
            style={
              factor < 1
                ? {
                    height: Math.round(ROW_HEIGHTS[row.type] * factor),
                    opacity: factor,
                    overflow: "hidden",
                  }
                : undefined
            }
          >
            {content}
          </div>
        );

        if (row.type === "empty") {
          return shell(
            <p
              style={{ height: ROW_HEIGHTS.empty }}
              className={[
                "flex items-center px-3 text-xs text-fg-muted",
                TONE_STYLES[row.section.tone].tint,
              ].join(" ")}
            >
              {/* The row is one fixed-height line, so wrapping would clip. */}
              <span className="truncate">
                {isFiltered ? "No matches." : row.section.empty}
              </span>
            </p>,
          );
        }

        if (row.type === "chart") {
          return shell(
            <FlowChartRow
              balance={row.balance}
              series={selectTrendSeries(history, row.balance.key)}
              // A starred row carries its chart directly beneath it, so the
              // chart takes the section's tint too or the band breaks under
              // every favourite.
              tint={TONE_STYLES[row.section.tone].tint}
              onHover={onHover}
              onExpand={setExpanded}
              onFocusBoard={onFocusBoard}
            />,
          );
        }

        return shell(
          <FlowResourceRow
            balance={row.balance}
            sectionId={row.section.id}
            tone={row.section.tone}
            sign={row.section.sign}
            resource={resourcesByKey.get(row.balance.key)}
            isActive={activeResourceKey === row.balance.key}
            isHidden={hidden.has(row.balance.key)}
            isFavourite={favourites.has(row.balance.key)}
            manageMode={manageMode}
            onHover={onHover}
            onExpand={setExpanded}
            onFocusBoard={onFocusBoard}
          />,
        );
      })}

      <div style={{ height: bottomSpacer }} />

      {/*
        The pointed-at row, redrawn wide, in a portal to <body>.

        `position: fixed` is only fixed to the WINDOW while no ancestor claims it:
        a transform, a filter, a backdrop-filter, `contain` or a `will-change`
        anywhere up the chain makes that ancestor the containing block instead, and
        then the copy is measured from the panel rather than the viewport AND
        clipped by it — it lands low and stops dead at the panel's edge instead of
        reaching over the board. Rendered from <body> there is no chain to claim
        it, whatever the panels above it are doing. The board help sheet portals
        for the same reason.
      */}
      {expandedRow && typeof document !== "undefined"
        ? createPortal(
        <div
          // The row's own width is the animation's starting point, measured
          // when the pointer arrived, so the panel can be any width and the
          // grow still begins exactly where the real row ends.
          key={expandedRow.balance.key}
          ref={overlayRef}
          style={
            {
              // Where the row was when the pointer reached it, so the first
              // frame is drawn in the right place. From then on the layout
              // effect above owns these two, measured off the row itself.
              top: expandedRow.top,
              right: expandedRow.right,
              "--row-start-width": `${expandedRow.startWidth}px`,
            } as React.CSSProperties
          }
          // One ring around the pair, so the row and its chart read as a
          // single lit block instead of two separately outlined things.
          // A pointer GHOST: every event falls through to the real list
          // underneath, so the wheel scrolls it, the scrollbar stays
          // grabbable through the copy, and a double-click still flies the
          // board — while the copy itself just SHOWS the full name. Only the
          // mark buttons opt back into the pointer (pointer-events-auto on
          // themselves). Hover and dismissal are the underlying rows' and the
          // document watcher's job now, not this element's.
          className="resource-row-expand pointer-events-none fixed z-[60] overflow-hidden rounded bg-surface-raised shadow-xl ring-1 ring-cyan-500/60"
        >
          <FlowResourceRow
            balance={expandedRow.balance}
            sectionId={expandedRow.section.id}
            tone={expandedRow.section.tone}
            sign={expandedRow.section.sign}
            resource={resourcesByKey.get(expandedRow.balance.key)}
            isActive
            isHidden={hidden.has(expandedRow.balance.key)}
            isFavourite={favourites.has(expandedRow.balance.key)}
            manageMode={manageMode}
            expanded
            onHover={onHover}
            onExpand={setExpanded}
            onMarkChanged={dismissExpanded}
            onFocusBoard={onFocusBoard}
          />
          {/* The chart comes along, so the pair widens together rather than
              leaving the graph at column width under a row that grew. */}
          {showCharts && favourites.has(expandedRow.balance.key) ? (
            <FlowChartRow
              balance={expandedRow.balance}
              series={selectTrendSeries(history, expandedRow.balance.key)}
              expanded
              onHover={onHover}
              onExpand={setExpanded}
              onFocusBoard={onFocusBoard}
            />
          ) : null}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * The chart that sits under a starred resource, two rows tall.
 *
 * It shares the row above's hover: pointing anywhere at the pair lights the
 * same machines on the board, so a resource and its history behave as one
 * block rather than two things that happen to be adjacent.
 */
const FlowChartRow = memo(function FlowChartRow({
  balance,
  series,
  tint = "",
  expanded = false,
  onHover,
  onExpand,
  onFocusBoard,
}: {
  balance: ResourceBalance;
  series: number[];
  /** The section colour its row carries, so the pair reads as one block. */
  tint?: string;
  expanded?: boolean;
  onHover: (resourceKey?: string) => void;
  onExpand: (resourceKey: string, top: number, right: number, startWidth: number) => void;
  onFocusBoard: (resourceKey: string) => void;
}) {
  return (
    <div
      data-resource-chart={balance.key}
      style={{ height: ROW_HEIGHTS.chart }}
      className={["px-1 pb-1", tint].join(" ")}
      onMouseEnter={(event) => {
        onHover(balance.key);
        // Widens with its row: the chart is the half of the pair that most
        // needs the extra width, since more pixels across is literally more
        // edits you can pick out. The top of the PAIR is what the overlay
        // anchors to, so this reports its row's top, not its own.
        const box = event.currentTarget.getBoundingClientRect();
        onExpand(
          balance.key,
          box.top - ROW_HEIGHTS.item,
          document.documentElement.clientWidth - box.right,
          box.width,
        );
      }}
      onMouseLeave={expanded ? undefined : () => onHover(undefined)}
      // Same gesture as the row above it, so the pair behaves as one thing.
      onDoubleClick={() => onFocusBoard(balance.key)}
    >
      {/* Deliberately one look, hovered or not. Tinting it on hover made the
          chart change colour as it widened, which read as the DATA changing
          rather than the pointer moving. Inside the wide copy it drops its own
          frame, because the wrapper already rings the whole pair. */}
      <div
        className={[
          "h-full rounded px-1",
          expanded ? "" : "border border-line bg-surface-sunken/40",
        ].join(" ")}
      >
        <TrendSparkline
          series={series}
          height={ROW_HEIGHTS.chart - 10}
          unit={rateUnitFor(balance.kind)}
          multiplier={rateUnitMultiplier()}
        />
      </div>
    </div>
  );
});

function FlowSectionHeader({
  section,
  collapsed,
  isFiltered,
  onToggle,
}: {
  section: FlowSection;
  collapsed: boolean;
  isFiltered: boolean;
  onToggle: (id: FlowSectionId) => void;
}) {
  const tone = TONE_STYLES[section.tone];
  const showRatio = isFiltered && section.items.length !== section.totalCount;

  return (
    <button
      type="button"
      onClick={() => onToggle(section.id)}
      aria-expanded={!collapsed}
      style={{ height: ROW_HEIGHTS.header }}
      className={[
        "sticky top-0 z-10 flex w-full items-center gap-2 border-y px-2 text-left backdrop-blur-sm",
        tone.header,
      ].join(" ")}
    >
      <span className={["text-[11px] leading-none", collapsed ? "" : "rotate-90"].join(" ")}>▶</span>
      <span className="text-sm font-bold uppercase tracking-wider">{section.label}</span>
      <span className={["rounded px-1.5 py-0.5 text-xs font-bold tabular-nums", tone.badge].join(" ")}>
        {showRatio ? `${section.items.length} / ${section.totalCount}` : section.totalCount}
      </span>
    </button>
  );
}

const FlowResourceRow = memo(function FlowResourceRow({
  balance,
  sectionId,
  tone,
  sign,
  resource,
  isActive,
  isHidden,
  isFavourite,
  manageMode,
  expanded = false,
  onHover,
  onExpand,
  onMarkChanged,
  onFocusBoard,
}: {
  balance: ResourceBalance;
  sectionId: FlowSectionId;
  tone: FlowSectionTone;
  sign: -1 | 0 | 1;
  resource?: FlowResourceDisplay;
  isActive: boolean;
  isHidden: boolean;
  isFavourite: boolean;
  manageMode: boolean;
  /** The wide copy floating over the board: no truncation, opaque, raised. */
  expanded?: boolean;
  onHover: (resourceKey?: string) => void;
  onExpand: (resourceKey: string, top: number, right: number, startWidth: number) => void;
  /** Raised after a star or hide, so the wide copy can stand down. */
  onMarkChanged?: () => void;
  onFocusBoard: (resourceKey: string) => void;
}) {
  const toneStyle = TONE_STYLES[tone];
  const value = getFlowRowValue(sectionId, balance);
  const unit = rateUnitFor(balance.kind);
  const prefix = sign === -1 ? "−" : sign === 1 ? "+" : "";
  const name = balance.displayName ?? balance.resourceId;

  return (
    // The row is a group, not one button: the star and the eye are their own
    // controls, and a button cannot legally live inside another button.
    <div
      // Only the real rows are findable by key: the wide copy is what gets
      // positioned FROM one, so it must not be able to answer that query itself.
      data-resource-row={expanded ? undefined : balance.key}
      data-resource-hidden={isHidden ? "true" : undefined}
      style={{ height: ROW_HEIGHTS.item }}
      className={[
        "group relative px-1",
        // The section's colour, on the WRAPPER rather than the button inside
        // it. The button paints the cyan hover and the active highlight, so a
        // tint there would be competing with them for the same property;
        // underneath, it simply shows through until something covers it.
        toneStyle.tint,
        // Heavy enough to read as "struck off the list" at a glance, while
        // still legible enough to find the row you came here to unhide.
        isHidden ? "opacity-30 grayscale" : "",
      ].join(" ")}
      onMouseEnter={(event) => {
        onHover(balance.key);
        // The pointed-at row is re-drawn wider, out over the board, so a long
        // name can be read in full without the column being sized for the
        // worst case at all times. It has to be a separate fixed-position
        // layer: this row lives in an `overflow-y: auto` box, which clips
        // anything reaching past its left edge, so widening in place would
        // just truncate somewhere else. The copy is pointer-transparent, so
        // this enter keeps firing through it and keeps the expansion fresh.
        const box = event.currentTarget.getBoundingClientRect();
        onExpand(
          balance.key,
          box.top,
          document.documentElement.clientWidth - box.right,
          box.width,
        );
      }}
      onMouseLeave={expanded ? undefined : () => onHover(undefined)}
    >
      <button
        type="button"
        onFocus={() => onHover(balance.key)}
        onBlur={() => onHover(undefined)}
        // No click-to-lock. Pointing at a row lights its machines and looking
        // away puts them out; a single click used to leave the board blinking
        // at you until you found the row again to switch it off.
        onDoubleClick={() => onFocusBoard(balance.key)}
        // No `title`. The browser's own tooltip fired on every row the pointer
        // crossed, which on a list this dense meant a yellow box trailing the
        // cursor the whole way down. The row already widens on hover to show
        // the full name, which is what the tooltip was carrying.
        style={{ gridTemplateColumns: `${ICON_COLUMN} minmax(0,1fr) auto auto` }}
        className={[
          // The highlight is a ring rather than a border: a border would take a
          // pixel off the top and bottom of the content box, leaving the icon
          // short of the row edges and reopening the band between rows.
          //
          // Spacing is per cell, not a grid `gap`. A gap also applies BETWEEN
          // the rate and the collapsed columns after it, so every ordinary row
          // paid for two gaps it could not use and the rates sat well short of
          // the panel edge.
          "grid h-full w-full items-center rounded pr-1 text-left",
          // The wide copy carries no highlight of its own: its wrapper rings
          // the row and the chart together as one block.
          expanded
            ? ""
            : isActive
              ? "bg-cyan-500/10 ring-1 ring-cyan-500/60"
              : "hover:bg-cyan-500/10 hover:ring-1 hover:ring-cyan-500/60",
        ].join(" ")}
      >
        {/*
          Sized from ROW_HEIGHTS.item directly. The icon used to carry its own
          height utility, which left it free to end up shorter than the row and
          centred there — the band above and below it is what read as space
          between rows. Filling an explicitly row-height box removes that.
        */}
        <span
          style={{ height: ROW_HEIGHTS.item, width: ROW_HEIGHTS.item }}
          className="flex shrink-0 items-center justify-center overflow-hidden"
        >
          <ResourceIcon
            resource={{
              kind: balance.kind,
              id: balance.resourceId,
              amount: 1,
              displayName: balance.displayName,
              iconPath: resource?.iconPath,
              iconAtlas: resource?.iconAtlas,
              // Needed for the fluid fallback, which has no art to fall back on.
              dominantColor: resource?.dominantColor,
            }}
            size="sm"
            showAmount={false}
            bare
            tooltip={false}
            className="!h-full !w-full"
          />
        </span>

        {/* Truncates in the wide copy too. The extra width fits most names in
            full, which is the point, but a name longer than even that has to
            end in an ellipsis rather than run under the rate. */}
        <span className="ml-2 flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-base font-medium text-fg">{name}</span>
        </span>

        <span
          className={["ml-2 flex shrink-0 items-baseline", toneStyle.value].join(" ")}
        >
          <span className="text-base font-bold tabular-nums">
            {prefix}
            {/* Eases to a new solve on the board's value-motion clock; the
                sign and tone flip immediately, only the digits travel. */}
            <MotionNumberText
              values={[Math.abs(value)]}
              render={(shown) => formatRateValue(shown[0] ?? Math.abs(value))}
            />
            <span className="ml-0.5 text-[11px] font-semibold opacity-70">{unit}</span>
          </span>

          {/*
            The star sits past the rate, at the far right. Anchored there it
            holds still when the row widens on hover - beside the name it slid
            along with the text.

            It fades out exactly when the mark buttons slide in, because the
            favourite button is itself a filled star: with both up the row
            showed two stars side by side. Only a starred row spends any width
            on it, so an ordinary rate runs right up to the panel edge.
          */}
          {isFavourite ? (
            <span
              aria-hidden
              className={[
                "ml-1 shrink-0 text-[11px] leading-none text-amber-300",
                manageMode || expanded
                  ? "opacity-0"
                  : "group-focus-within:opacity-0 group-hover:opacity-0",
              ].join(" ")}
            >
              ★
            </span>
          ) : null}
        </span>

        {/*
          The room the mark buttons slide into, on the right where they belong.
          A real grid column rather than a layer on top of the rate: as an
          overlay the hide button sat exactly where the number was, so aiming
          at a rate and clicking hid the resource. Zero-wide until the row is
          pointed at, so no width is spent on rows nobody is looking at.

          Class names are written out in full rather than composed: Tailwind
          scans the source for literals, so an interpolated one is never
          generated.
        */}
        <span
          className={[
            // The class is the hook for the wide copy's own arrival animation
            // (globals.css): a copy mounts already open, so it has no previous
            // width to transition from.
            "resource-row-marks-gap overflow-hidden transition-[width] duration-100",
            isFavourite
              ? manageMode || expanded
                ? "w-6"
                : "w-0 group-focus-within:w-6 group-hover:w-6"
              : manageMode || expanded
                ? "w-11"
                : "w-0 group-focus-within:w-11 group-hover:w-11",
          ].join(" ")}
        />
      </button>

      {/*
        The buttons themselves. Absolute so they never affect the row's height,
        and `pointer-events-none` on the bar so only the button squares are
        clickable - the gaps around them fall through to the row.

        Manage mode holds the gap open on every row at once: with the eye
        switched on the user is here to sort out what is hidden, and the
        controls should not have to be hunted for one row at a time.
      */}
      <div
        className={[
          "resource-row-marks pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5",
          manageMode || expanded
            ? ""
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        ].join(" ")}
      >
        <RowMarkButton
          onClick={() => {
            toggleResourceFavourite(balance.key);
            onMarkChanged?.();
          }}
          title={
            isFavourite
              ? `Stop watching ${name}`
              : isHidden
                ? `Watch ${name}, which unhides it`
                : `Watch ${name} and chart it`
          }
          on={isFavourite}
          onClass="text-amber-300"
        >
          {isFavourite ? "★" : "☆"}
        </RowMarkButton>
        {/* A starred resource has no hide button: you asked to watch it, so
            hiding it is not a thing you can then ask for. Starring a hidden
            one unhides it, which is why this can never strand a row. */}
        {isFavourite ? null : (
          <RowMarkButton
            onClick={() => {
              toggleResourceHidden(balance.key);
              onMarkChanged?.();
            }}
            title={isHidden ? `Unhide ${name}` : `Hide ${name} from this list`}
            on={isHidden}
            onClass="text-cyan-300"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">
              {isHidden ? <EyeIcon /> : <EyeOffIcon />}
            </span>
          </RowMarkButton>
        )}
      </div>
    </div>
  );
});

function RowMarkButton({
  onClick,
  title,
  on,
  onClass,
  children,
}: {
  onClick: () => void;
  title: string;
  on: boolean;
  onClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      // The bar around these is pointer-events-none so it can never swallow a
      // click meant for the rate behind it; the buttons opt back in.
      className={[
        "pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-[13px] leading-none hover:bg-surface-sunken",
        on ? onClass : "text-fg-muted hover:text-fg",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * `tint` is the section's colour at 5%, carried by every row under the header
 * so a group reads as one band rather than a coloured bar with grey underneath
 * it. Faint on purpose: it has to survive behind icons and rates and lose to
 * the cyan hover, so it is doing the job of a margin rather than a highlight.
 */
const TONE_STYLES: Record<
  FlowSectionTone,
  { header: string; badge: string; value: string; tint: string }
> = {
  need: {
    header:
      "border-red-500/40 bg-red-950/85 text-red-100 hover:bg-red-900/60",
    badge: "bg-red-500/30 text-red-50",
    value: "text-red-300",
    tint: "bg-red-500/5",
  },
  /*
   * One Outputs section, one colour: green, the Output colour this panel has
   * had since before the one-day product/byproduct split. Red in, green out.
   */
  output: {
    header: "border-emerald-500/40 bg-emerald-950/85 text-emerald-100 hover:bg-emerald-900/60",
    badge: "bg-emerald-500/30 text-emerald-50",
    value: "text-emerald-300",
    tint: "bg-emerald-500/5",
  },
  internal: {
    header:
      "border-line bg-surface-sunken/90 text-fg-subtle hover:bg-surface",
    badge: "bg-fg-muted/20 text-fg-subtle",
    value: "text-fg-subtle",
    // No tint. Internal is the long tail and the one group that means "nothing
    // to see"; painting it too would make the panel a stack of colours with no
    // quiet ground to read the others against.
    tint: "",
  },
};

type FlowResourceDisplay = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildProjectResourceLookup(project: FactoryProject): Map<string, FlowResourceDisplay> {
  const resources = new Map<string, FlowResourceDisplay>();
  const addResource = (resource: FlowResourceDisplay) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = resources.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      resources.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      addResource(resource);
    }
  }

  for (const storage of project.storages ?? []) {
    addResource({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }

  return resources;
}
