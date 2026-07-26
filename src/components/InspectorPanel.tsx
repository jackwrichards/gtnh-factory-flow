"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRate } from "@/lib/model";
import type { FactoryProject, ResourceAmount, ResourceBalance } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  buildFlowRows,
  filterFlowBalances,
  findRowIndexAtOffset,
  getFlowRowValue,
  measureFlowRows,
  type FlowRow,
  type FlowSection,
  type FlowSectionId,
  type FlowSectionTone,
} from "./inspector/flow-sections";
import { PowerBreakdown } from "./inspector/PowerBreakdown";
import { ResourceIcon } from "./nei/ResourceIcon";

const FLOW_FILTER_DEBOUNCE_MS = 120;

// A row cannot be shorter than its icon, so row height and icon size are one
// decision, not two: the icon fills the row edge to edge with no padding, which is
// what makes consecutive rows butt up with no band between them. Both the icon
// column and the icon box are derived from ROW_HEIGHTS.item rather than restated
// as a utility class, so the two can never drift apart. This is the single lever
// for how many resources fit on screen.
const ROW_HEIGHTS = { header: 24, item: 30, empty: 24 };
const ICON_COLUMN = `${ROW_HEIGHTS.item}px`;
const ROW_OVERSCAN = 6;

export function InspectorPanel() {
  return (
    <aside className="flex h-full min-h-[360px] flex-col bg-surface">
      <SummaryPanel />
    </aside>
  );
}

function SummaryPanel() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const setHoveredNodeBottlenecks = useFactoryStore((state) => state.setHoveredNodeBottlenecks);
  const toggleNodeBottlenecks = useFactoryStore((state) => state.toggleNodeBottlenecks);
  const nodeBottlenecks = useMemo(
    () => result.bottlenecks.filter((bottleneck) => bottleneck.kind === "node-capacity").length,
    [result.bottlenecks],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
      <div className="grid shrink-0 grid-cols-4 gap-1">
        <Metric label="EU/t" value={formatRate(result.totalEuT, 0)} />
        <Metric label="EU/s" value={formatRate(result.totalEuPerSecond, 0)} />
        <Metric label="Nodes" value={String(project.nodes.length)} />
        <Metric
          label="Capped"
          value={String(nodeBottlenecks)}
          tone={nodeBottlenecks > 0 ? "alert" : "default"}
          active={hoveredNodeBottlenecks || selectedNodeBottlenecks}
          interactive={nodeBottlenecks > 0}
          onMouseEnter={() => setHoveredNodeBottlenecks(nodeBottlenecks > 0)}
          onMouseLeave={() => setHoveredNodeBottlenecks(false)}
          onFocus={() => setHoveredNodeBottlenecks(nodeBottlenecks > 0)}
          onBlur={() => setHoveredNodeBottlenecks(false)}
          onClick={nodeBottlenecks > 0 ? toggleNodeBottlenecks : undefined}
        />
      </div>

      <PowerBreakdown />

      <FlowIOPanel />
    </div>
  );
}

function FlowIOPanel() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const setHoveredFlowResourceKey = useFactoryStore((state) => state.setHoveredFlowResourceKey);
  const selectFlowResourceKey = useFactoryStore((state) => state.selectFlowResourceKey);

  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<FlowSectionId, boolean>>({
    need: false,
    output: false,
    internal: false,
  });

  const resourcesByKey = useMemo(() => buildProjectResourceLookup(project), [project]);
  // Hundreds of rows carrying resource icons, so the list follows the settled
  // filter. The input stays on the raw value and remains instant.
  const debouncedFilter = useDebouncedValue(filter, FLOW_FILTER_DEBOUNCE_MS);

  const balanced = useMemo(
    () =>
      Object.values(result.resources)
        .filter(
          (balance) =>
            balance.producedPerSecond > 0 &&
            balance.consumedPerSecond > 0 &&
            balance.deficitPerSecond <= 0.000001 &&
            balance.surplusPerSecond <= 0.000001,
        )
        .sort((left, right) => right.consumedPerSecond - left.consumedPerSecond),
    [result.resources],
  );

  const sections = useMemo<FlowSection[]>(() => {
    const build = (
      id: FlowSectionId,
      label: string,
      hint: string,
      empty: string,
      tone: FlowSectionTone,
      sign: -1 | 0 | 1,
      items: ResourceBalance[],
    ): FlowSection => ({
      id,
      label,
      hint,
      empty,
      tone,
      sign,
      items: filterFlowBalances(items, debouncedFilter),
      totalCount: items.length,
    });

    return [
      build(
        "need",
        "Need",
        "must be imported",
        // One line each: the row is a single fixed-height line, and the header
        // hint beside the count already says what the group means.
        "Nothing missing.",
        "need",
        -1,
        result.externalInputs,
      ),
      build(
        "output",
        "Output",
        "leaves the plan",
        "Nothing left over.",
        "output",
        1,
        result.unconsumedOutputs,
      ),
      build(
        "internal",
        "Internal",
        "made and used in-plan",
        "Nothing internal.",
        "internal",
        0,
        balanced,
      ),
    ];
  }, [balanced, debouncedFilter, result.externalInputs, result.unconsumedOutputs]);

  const toggleSection = useCallback((id: FlowSectionId) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const activeResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const matchCount = sections.reduce((total, section) => total + section.items.length, 0);
  const isFiltered = debouncedFilter.trim().length > 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded border border-line bg-surface-raised">
      <div className="shrink-0 border-b border-line p-1">
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
        selectedResourceKey={selectedFlowResourceKey}
        onToggleSection={toggleSection}
        onHover={setHoveredFlowResourceKey}
        onSelect={selectFlowResourceKey}
      />
    </section>
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
  selectedResourceKey,
  onToggleSection,
  onHover,
  onSelect,
}: {
  sections: FlowSection[];
  collapsed: Record<FlowSectionId, boolean>;
  isFiltered: boolean;
  resourcesByKey: Map<string, FlowResourceDisplay>;
  activeResourceKey?: string;
  selectedResourceKey?: string;
  onToggleSection: (id: FlowSectionId) => void;
  onHover: (resourceKey?: string) => void;
  onSelect: (resourceKey: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  const rows = useMemo(() => buildFlowRows(sections, collapsed), [collapsed, sections]);
  const { offsets, totalHeight } = useMemo(() => measureFlowRows(rows, ROW_HEIGHTS), [rows]);

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

        if (row.type === "empty") {
          return (
            <p
              key={row.key}
              style={{ height: ROW_HEIGHTS.empty }}
              className="flex items-center px-3 text-xs text-fg-muted"
            >
              {/* The row is one fixed-height line, so wrapping would clip. */}
              <span className="truncate">
                {isFiltered ? "No matches." : row.section.empty}
              </span>
            </p>
          );
        }

        return (
          <FlowResourceRow
            key={row.key}
            balance={row.balance}
            sectionId={row.section.id}
            tone={row.section.tone}
            sign={row.section.sign}
            resource={resourcesByKey.get(row.balance.key)}
            isActive={activeResourceKey === row.balance.key}
            isSelected={selectedResourceKey === row.balance.key}
            onHover={onHover}
            onSelect={onSelect}
          />
        );
      })}

      <div style={{ height: bottomSpacer }} />
    </div>
  );
}

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
      <span className="ml-auto truncate text-xs opacity-60">{section.hint}</span>
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
  isSelected,
  onHover,
  onSelect,
}: {
  balance: ResourceBalance;
  sectionId: FlowSectionId;
  tone: FlowSectionTone;
  sign: -1 | 0 | 1;
  resource?: FlowResourceDisplay;
  isActive: boolean;
  isSelected: boolean;
  onHover: (resourceKey?: string) => void;
  onSelect: (resourceKey: string) => void;
}) {
  const toneStyle = TONE_STYLES[tone];
  const value = getFlowRowValue(sectionId, balance);
  const unit = balance.kind === "fluid" ? "L/s" : "/s";
  const prefix = sign === -1 ? "−" : sign === 1 ? "+" : "";

  return (
    <div style={{ height: ROW_HEIGHTS.item }} className="px-1">
      <button
        type="button"
        onMouseEnter={() => onHover(balance.key)}
        onMouseLeave={() => onHover(undefined)}
        onFocus={() => onHover(balance.key)}
        onBlur={() => onHover(undefined)}
        onClick={() => onSelect(balance.key)}
        // The produced/consumed detail lives here now that the row is one line.
        title={`${balance.displayName ?? balance.resourceId} — produced ${formatRate(
          balance.producedPerSecond,
          3,
        )}${unit}, consumed ${formatRate(balance.consumedPerSecond, 3)}${unit}`}
        style={{ gridTemplateColumns: `${ICON_COLUMN} minmax(0,1fr) auto` }}
        className={[
          // The highlight is a ring rather than a border: a border would take a
          // pixel off the top and bottom of the content box, leaving the icon
          // short of the row edges and reopening the band between rows.
          "grid h-full w-full items-center gap-2 rounded pr-2 text-left",
          isSelected
            ? "bg-cyan-100 ring-2 ring-cyan-500 dark:bg-cyan-500/25 dark:ring-cyan-500/50"
            : isActive
              ? "bg-cyan-50 ring-1 ring-cyan-300 dark:bg-cyan-500/10 dark:ring-cyan-500/60"
              : "hover:bg-cyan-50 hover:ring-1 hover:ring-cyan-300 dark:hover:bg-cyan-500/10 dark:hover:ring-cyan-500/60",
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

        <span className="truncate text-base font-medium text-fg">
          {balance.displayName ?? balance.resourceId}
        </span>

        <span className={["text-base font-bold tabular-nums", toneStyle.value].join(" ")}>
          {prefix}
          {formatRate(Math.abs(value), 3)}
          <span className="ml-0.5 text-[11px] font-semibold opacity-70">{unit}</span>
        </span>
      </button>
    </div>
  );
});

const TONE_STYLES: Record<FlowSectionTone, { header: string; badge: string; value: string }> = {
  need: {
    header:
      "border-red-300/70 bg-red-50/95 text-red-900 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-950/85 dark:text-red-100 dark:hover:bg-red-900/60",
    badge: "bg-red-500/20 text-red-900 dark:bg-red-500/30 dark:text-red-50",
    value: "text-red-700 dark:text-red-300",
  },
  output: {
    header:
      "border-emerald-300/70 bg-emerald-50/95 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-950/85 dark:text-emerald-100 dark:hover:bg-emerald-900/60",
    badge: "bg-emerald-500/20 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-50",
    value: "text-emerald-700 dark:text-emerald-300",
  },
  internal: {
    header:
      "border-line bg-surface-sunken/95 text-fg-subtle hover:bg-surface dark:border-line dark:bg-surface-sunken/90",
    badge: "bg-fg-muted/20 text-fg-subtle",
    value: "text-fg-subtle",
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

function Metric({
  label,
  value,
  tone = "default",
  active = false,
  interactive = false,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "default" | "alert";
  active?: boolean;
  interactive?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClick?: () => void;
}) {
  const className = [
    "rounded border px-2 py-1 text-left",
    active
      ? "border-cyan-500 bg-cyan-100 ring-1 ring-cyan-300 dark:bg-cyan-500/25 dark:ring-cyan-500/50"
      : tone === "alert"
        ? "border-red-300 bg-red-50 dark:border-red-500/50 dark:bg-red-500/15"
        : "border-line bg-surface-raised",
    interactive
      ? "cursor-pointer hover:border-cyan-300 hover:bg-cyan-50 dark:hover:border-cyan-500/60 dark:hover:bg-cyan-500/10"
      : "",
  ].join(" ");
  const content = (
    <>
      <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-fg-muted">
        {label}
      </div>
      <div
        className={[
          "truncate text-base font-bold leading-tight tabular-nums",
          tone === "alert" && !active ? "text-red-700 dark:text-red-300" : "text-fg",
        ].join(" ")}
      >
        {value}
      </div>
    </>
  );

  if (!interactive) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      className={className}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      title="Highlight bottleneck nodes"
    >
      {content}
    </button>
  );
}
