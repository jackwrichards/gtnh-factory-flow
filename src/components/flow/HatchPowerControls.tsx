"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isTouchPointer } from "@/lib/pointer-kind";
import { isCompactViewport } from "@/lib/compact-view";
import { ArrowRight, Equal, X } from "lucide-react";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { GT_VOLTAGE_TIERS, getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { formatCompact, formatPowerValue } from "@/lib/model";
import { powerDisplayFromEuT, powerDisplaySuffix } from "@/lib/model/rate-unit";
import { useRateDisplayUnits } from "@/store/factory-store";
import { getNodePowerReport } from "@/lib/solver/power-report";
import { describePowerWorking } from "@/lib/solver/power-working";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { MAX_HATCH_AMPS, ampsForNewTier, stepWholeAmp, stepPowerOfFourAmps } from "@/lib/solver/hatch-input";
import { fullParallelPowerWin, listPowerWinsCached, powerNodeAtBudget } from "@/lib/solver/power-wins";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { getMachineStructuralParallels } from "@/lib/solver/machine-effects";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { GT_TIER_COLORS } from "./tier-colors";
import { useBoardMotion } from "./board-motion";

type Tier = NonNullable<FactoryNode["hatchVoltageTier"]>;

function TouchPowerPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(<dialog ref={dialog} aria-label="Machine power settings"
    className="ui-zoom nodrag nopan nowheel m-auto max-h-[calc(100*var(--ui-dvh)-24px)] w-[520px] max-w-[calc(100*var(--ui-vw)-24px)] overflow-y-auto overscroll-contain border-2 border-line bg-surface p-3 text-fg backdrop:bg-black/70"
    onCancel={onClose} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
    onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <strong>Machine power settings</strong>
      <button autoFocus className="min-h-11 min-w-11 border border-line px-3" onClick={onClose}>Done</button>
    </div>
    {children}
  </dialog>, document.body);
}
const chip =
  "nodrag nowheel flex h-6 min-w-0 items-center justify-center border-2 px-1 pb-[3px] pt-0 text-center text-[11px] font-bold leading-none shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110";
const number = (n: number) =>
  n.toLocaleString(
    "en-US",
    n > 0 && n < 0.01 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 },
  );

export function TierBadge({ tier }: { tier: Tier }) {
  const color = GT_TIER_COLORS[tier];
  return (
    <span
      className="inline-flex items-center justify-center border px-1 font-semibold leading-4"
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
        textDecoration: color.underline ? "underline" : undefined,
      }}
    >
      {tier}
    </span>
  );
}
function Comparison({ label, current, next, unit }: { label: string; current: number; next: number; unit?: string }) {
  const format = (value: number) => value >= 10000 ? formatCompact(value) : number(value);
  return (
    <div className="flex h-[42px] min-w-0 flex-col items-center justify-center border border-line bg-[var(--mc-33)] px-1.5">
      <span className="text-fg-muted">{label}{unit ? <> <span className="text-[11px]">{unit}</span></> : null}</span>
      <span className="flex items-center justify-center gap-1 font-semibold tabular-nums text-fg" title={number(current) + " → " + number(next) + (unit ? " " + unit : "")}>
        <span>{format(current)}</span>
        <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={3} />
        <span>{format(next)}</span>
      </span>
    </div>
  );
}

/** Fixed staggered lanes keep coincident draw/supply and adjacent steps legible. */
function PowerScaleMarker({ position, label, caption, lane, kind, transition, title }: {
  position: number;
  label: string;
  caption?: string;
  lane: "top" | "upper" | "lower" | "bottom";
  kind: "supplied" | "draw" | "threshold";
  transition?: string;
  title?: string;
}) {
  const percent = Math.max(0, Math.min(1, position)) * 100;
  const top = { top: 0, upper: 16, lower: 42, bottom: 58 }[lane];
  return <>
    <span aria-hidden className="absolute border-l border-[var(--mc-ink-muted)] motion-reduce:!transition-none"
      style={{ left: percent + "%", top: lane === "top" ? 16 : lane === "upper" ? 30 : 42,
        height: lane === "top" || lane === "bottom" ? 16 : 2, transition }} />
    <span aria-hidden className="absolute z-10 w-[3px] bg-[var(--mc-ink)] shadow-[0_0_0_1px_var(--mc-15)] motion-reduce:!transition-none"
      style={{ left: "clamp(1px, " + percent + "%, calc(100% - 3px))",
        top: kind === "draw" ? 37 : kind === "supplied" ? 31 : 30,
        height: kind === "draw" ? 7 : kind === "supplied" ? 12 : 14, transition }} />
    <span className="absolute z-20 whitespace-nowrap bg-[var(--mc-49)] px-0.5 font-medium leading-4 text-fg motion-reduce:!transition-none"
      data-power-scale-label={kind}
      title={title}
      style={{ left: percent + "%", top, transform: "translateX(-" + percent + "%)", transition }}>
      {label}{caption ? <> <span className="font-normal text-fg-muted">{caption}</span></> : null}
    </span>
  </>;
}

type Consumption = {
  mode: "build" | "solve" | "pool";
  plannedEuT?: number;
  utilization?: number;
  sharedAverageEuT?: number;
  shared?: boolean;
};
export function PowerReadout({
  recipe,
  node,
  mode,
  plannedEuT,
  utilization,
  sharedAverageEuT,
  shared,
  compact = false,
}: { recipe: Recipe; node: FactoryNode; compact?: boolean } & Consumption) {
  useRateDisplayUnits();
  const displayPower = (euT: number) => `${formatPowerValue(powerDisplayFromEuT(euT))} ${powerDisplaySuffix()}`;
  const report = getNodePowerReport(recipe, node);
  const working = useMemo(
    () => describePowerWorking(recipe, node, report.poolEuT),
    [recipe, node, report.poolEuT],
  );
  const wins = useMemo(() => listPowerWinsCached(recipe, node), [recipe, node]);
  const hasOverclocks = wins.some((win) => win.overclockSteps > 0);
  const hasParallels = wins.some((win) => win.parallels > 1);
  const stats = getOverclockedRecipeStats(recipe, node);
  const voltage = getVoltageTierMaxEuT(report.tier);
  const parallelTarget = useMemo(() => fullParallelPowerWin(recipe, node, wins), [recipe, node, wins]);
  const next = parallelTarget ?? working.nextWin;
  const targetLabel = parallelTarget ? "Max parallels" : "Next improvement";
  const { valueMotion } = useBoardMotion();
  const barTransition = valueMotion ? "width 240ms ease-out, left 240ms ease-out, transform 240ms ease-out" : undefined;
  const nextNode = next ? powerNodeAtBudget(node, next.euT) : undefined;
  const nextReport = nextNode ? getNodePowerReport(recipe, nextNode) : undefined;
  const nextStats = nextNode ? getOverclockedRecipeStats(recipe, nextNode) : undefined;
  // Round thresholds upward so typing the displayed amount actually reaches them.
  const extraAmps = next ? Math.ceil(((next.euT - report.poolEuT) / voltage) * 100) / 100 : 0;
  const ampsPerHatch = report.amps === 1 ? 1 : 2;
  const equivalent = report.amps / ampsPerHatch;
  const duration = stats.durationTicks / 20;
  const scaleEuT = next?.euT ?? 1;
  const progress = Math.max(0, Math.min(1, report.poolEuT / scaleEuT));
  const raw = node.powerInputMode === "eut";
  const capacity = getMachineStructuralParallels(applyMachineHandlerToRecipe(recipe, node), node);
  const running = report.state === "ok" ? report.parallels : 0;
  const nextRunning = nextReport?.state === "ok" ? nextReport.parallels : running;
  const suppliedText = raw ? `${formatCompact(report.poolEuT)} EU/t` : `${number(report.amps)}A`;
  const thresholdDigits = 2;
  const thresholdText = (euT: number) => raw
    ? formatCompact(euT) + " EU/t"
    : (Math.ceil(euT / voltage * 10 ** thresholdDigits) / 10 ** thresholdDigits)
        .toLocaleString("en-US", { maximumFractionDigits: thresholdDigits }) + "A";
  const nextText = thresholdText(next?.euT ?? 0);
  const machineCount = node.machineCount * Math.max(1, node.parallel);
  const usage = !node.enabled
    ? 0
    : utilization === undefined
      ? undefined
      : Math.max(0, Math.min(1, utilization));
  const average =
    usage === undefined
      ? undefined
      : !node.enabled
        ? 0
        : shared
          ? (sharedAverageEuT ?? 0) / Math.max(1, machineCount)
          : (report.state === "ok" ? report.drawEuT : 0) * usage;
  const runningDraw = shared
    ? usage && average !== undefined
      ? average / usage
      : 0
    : report.state === "ok"
      ? report.drawEuT
      : 0;
  return (
    <div
      style={{ height: compact ? undefined : 372 - (next ? 0 : 158) - (!hasOverclocks && !hasParallels ? 18 : 0) }}
      className="flex w-[480px] max-w-full flex-col text-[13px] leading-[18px] text-fg-subtle"
      data-power-readout
    >
      <div className="flex h-5 shrink-0 items-center justify-between text-[15px] font-semibold leading-5 text-fg">
        <span>Power input</span>
        {raw ? <span className="tabular-nums">{formatCompact(report.poolEuT)} EU/t</span> : null}
      </div>
      {!raw ? (
        <div className={`mt-1 flex shrink-0 ${compact ? "flex-wrap gap-1" : "h-6 gap-3"} items-center justify-between whitespace-nowrap`}>
          <div className="flex min-w-0 items-center gap-1 font-medium tabular-nums text-fg">
            <span>{number(report.amps)}A ×</span>
            <TierBadge tier={report.tier} />
            <span className="truncate">= {number(report.poolEuT)} EU/t</span>
          </div>
          <span
            className="flex shrink-0 items-center justify-end gap-1 font-normal text-fg-subtle"
            data-hatch-equivalent
          >
            {equivalent.toLocaleString("en-US", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}{" "}
            <TierBadge tier={report.tier} /> hatches
            <span className="ml-1 text-fg-muted">({ampsPerHatch}A per hatch)</span>
          </span>
        </div>
      ) : null}
      <div
        style={{ height: !hasOverclocks && !hasParallels ? 66 : 84 }}
        className="my-2 grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 border-y border-line py-2"
      >
        {[
          ["Parallels", `${running} / ${capacity}`],
          [
            "Overclocks",
            working.rows.find((row) => row.id === "overclocks")?.supplied ??
              String(report.overclockSteps),
          ],
          [
            "Time / run",
            duration < 0.01 ? `${formatCompact(duration * 1000)} ms` : `${number(duration)} s`,
          ],
          ["Runs / second", report.state === "ok" ? number(report.parallels / duration) : "0"],
          ["EU / run", formatCompact(Math.abs(stats.eut) * stats.durationTicks)],
          ["Draw · EU/t", formatCompact(report.drawEuT)],
        ]
          .filter(
            ([label]) =>
              (label !== "Parallels" || hasParallels) && (label !== "Overclocks" || hasOverclocks),
          )
          .map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 items-baseline justify-between gap-x-2 whitespace-nowrap"
            >
              <span className="text-fg-muted">{label}</span>
              <span className="truncate font-medium tabular-nums text-fg">{value}</span>
            </div>
          ))}
      </div>
      {next ? (
        <section className="min-h-0 flex-1">
          <div className="flex h-5 items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-fg">
              {next ? targetLabel : "No further improvement"}
            </h3>
            <span className="flex items-center gap-1 font-medium text-fg">
              {next ? (
                <>
                  {raw
                    ? `+${formatCompact(next.euT - report.poolEuT)} EU/t`
                    : `+${number(extraAmps)}A`}
                  {!raw ? <TierBadge tier={report.tier} /> : null}
                </>
              ) : null}
            </span>
          </div>
          <div
            className={`mt-1.5 grid gap-2 ${hasParallels && hasOverclocks ? "grid-cols-3" : hasParallels || hasOverclocks ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {hasOverclocks ? (
              <Comparison
                label="Overclocks"
                current={report.state === "ok" ? report.overclockSteps : 0}
                next={nextReport?.overclockSteps ?? report.overclockSteps}
              />
            ) : null}
            {hasParallels ? (
              <Comparison label="Parallels" current={running} next={nextRunning} />
            ) : null}
            <Comparison label="Output" unit="runs/s"
              current={report.state === "ok" && stats.durationTicks > 0 ? running * 20 / stats.durationTicks : 0}
              next={nextReport && nextStats && nextStats.durationTicks > 0 ? nextReport.parallels * 20 / nextStats.durationTicks : 0} />
          </div>
          <div className="relative mt-1.5 h-[74px] tabular-nums" data-power-scale>
            <span className="absolute left-0 top-0 leading-4 text-fg-muted">{raw ? "0 EU/t" : "0A"}</span>
            <div
              role="progressbar"
              aria-label="Supplied power on the upcoming improvement scale"
              aria-valuemin={0}
              aria-valuemax={scaleEuT}
              aria-valuenow={Math.min(report.poolEuT, scaleEuT)}
              aria-valuetext={suppliedText + " supplied; " + targetLabel.toLowerCase() + " at " + nextText}
              className="absolute inset-x-0 top-8 h-2.5 border border-[var(--mc-15)] bg-[var(--mc-33)] p-px shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-15)]"
            >
              <div className="h-full bg-[var(--mc-ink-muted)] shadow-[inset_0_1px_0_var(--mc-100)] motion-reduce:!transition-none"
                style={{ width: progress * 100 + "%", transition: barTransition }} />
            </div>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[29px] h-[5px] opacity-45" data-power-history>
              {wins.filter((win) => win.euT < next.euT * (1 - 1e-9)).map((win) => (
                <span key={win.euT}
                  className="absolute h-full w-px bg-[var(--mc-ink)] motion-reduce:!transition-none"
                  style={{ left: "clamp(1px, " + win.euT / scaleEuT * 100 + "%, calc(100% - 1px))", transition: barTransition }} />
              ))}
            </div>
            <PowerScaleMarker position={progress} label={suppliedText} caption="supplied"
              lane="upper" kind="supplied" transition={barTransition} />
            <PowerScaleMarker position={runningDraw / scaleEuT}
              label={raw ? formatCompact(runningDraw) + " EU/t" : number(runningDraw / voltage) + "A"} caption="draw"
              lane="lower" kind="draw" transition={barTransition} />
            <PowerScaleMarker position={1} label={nextText} caption={parallelTarget ? "max parallels" : "next"} lane="top" kind="threshold"
              transition={barTransition} title={targetLabel + ": " + next.euT + " EU/t"} />
          </div>
        </section>
      ) : null}
      <div className={`mt-2 ${compact ? "" : "h-[58px]"} shrink-0 border-t border-line pt-1`} data-power-consumption>
        {mode !== "build" ? (
          plannedEuT === undefined ? (
            <p className="text-fg-muted">Power demand appears after calculation.</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-fg-muted">Demand for this card</span>
                <strong className="tabular-nums text-fg">
                  {displayPower(node.enabled ? plannedEuT : 0)}
                </strong>
              </div>
              <p className="text-fg-muted">
                {shared
                  ? "All recipes, across the required machines."
                  : "Across the required machines."}
              </p>
            </>
          )
        ) : usage === undefined || average === undefined ? (
          <p className="text-fg-muted">Average consumption appears after calculation.</p>
        ) : compact ? (
          <div className="flex flex-wrap justify-between gap-1">
            <span>Usage: {number(usage * 100)}%</span>
            <span>Average: {displayPower(average)} per machine</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[auto_minmax(24px,1fr)_auto_minmax(24px,1fr)_auto_minmax(24px,1fr)_auto] items-center gap-x-1 tabular-nums" aria-label="Average power consumption per machine">
              <div className="min-w-0">
                <div className="text-fg-muted">Supplied</div>
                <div className="whitespace-nowrap font-medium text-fg-subtle">{displayPower(report.poolEuT)}</div>
                <div className="flex h-[18px] items-center gap-1 text-fg-muted">
                  {raw ? "Available" : <>{number(report.amps)}A <TierBadge tier={report.tier} /></>}
                </div>
              </div>
              <ArrowRight aria-hidden className="h-5 w-5 justify-self-center text-fg-muted" strokeWidth={2.5} />
              <div className="min-w-0">
                <div className="text-fg-muted">{shared ? "Recipe mix" : "Actual draw"}</div>
                <div className="whitespace-nowrap font-medium text-fg">{displayPower(runningDraw)}</div>
                <div className="flex h-[18px] items-center gap-1 text-fg-muted">
                  {report.state !== "ok" ? "Blocked" : raw ? "While running" : <>{number(runningDraw / voltage)}A <TierBadge tier={report.tier} /></>}
                </div>
              </div>
              <X aria-hidden className="h-5 w-5 justify-self-center text-fg-muted" strokeWidth={2.5} />
              <div className="h-[54px]">
                <div className="text-fg-muted">Usage</div>
                <div className="font-medium text-fg">{number(usage * 100)}%</div>
              </div>
              <Equal aria-hidden className="h-5 w-5 justify-self-center text-fg-muted" strokeWidth={2.5} />
              <div className="min-w-0" title={machineCount > 1 ? displayPower(average * machineCount) + " average for this card" : "Average draw per machine"}>
                <div className="text-fg-muted">Average draw</div>
                <div className="whitespace-nowrap font-semibold text-fg">{displayPower(average)}</div>
                <div className="flex h-[18px] items-center gap-1 text-fg-muted">
                  {raw ? "Per machine" : <>{number(average / voltage)}A <TierBadge tier={report.tier} /></>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PowerControlsGuide({ raw = false, active }: { raw?: boolean; active?: "amount" | "tier" }) {
  const sections = [
    { id: "amount", title: raw ? "EU/t" : "Amps", rows: [
      ["Click", "Type value"], ["Scroll", "±1"], ["Ctrl + scroll", "±10"],
      ["Shift + scroll", raw ? "±100" : "1 · 4 · 16…"], ["Ctrl + Shift + scroll", "±1,000"],
    ] },
    { id: "tier", title: "Tier", rows: [
      ["Click / scroll", "Change tier"],
    ] },
  ];
  return <div className="w-[224px] max-w-full text-[12px] leading-normal text-fg-subtle">
    {sections.map(section => <section key={section.id} data-power-guide-section={section.id} data-active={active === section.id}
      className="mb-2 border-l-2 border-transparent pl-2 last:mb-0 data-[active=true]:border-fg-muted">
      <div className="mb-1 font-medium text-fg">{section.title}</div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
        {section.rows.map(([gesture, action]) => <div key={gesture} className="contents">
          <dt className="min-w-0">{gesture}</dt><dd className="text-right tabular-nums text-fg">{action}</dd>
        </div>)}
      </dl>
    </section>)}
  </div>;
}

export function HatchPowerControls({
  recipe,
  node,
  onChange,
  locked,
  mode,
  plannedEuT,
  utilization,
  sharedAverageEuT,
  shared,
}: {
  recipe: Recipe;
  node: FactoryNode;
  onChange: (tier: Tier, amps: number, mode: "amps" | "eut") => void;
  locked: () => boolean;
} & Consumption) {
  const { tier, amps, poolEuT } = getNodePowerReport(recipe, node);
  const raw = node.powerInputMode === "eut";
  const [draft, setDraft] = useState<string>();
  const [touchOpen, setTouchOpen] = useState(false);
  const touchPress = useRef(false);
  const [activeControl, setActiveControl] = useState<"amount" | "tier">("amount");
  const color = GT_TIER_COLORS[tier];
  const style = raw
    ? { backgroundColor: "var(--mc-85)", borderColor: "var(--mc-33)", color: "var(--mc-ink)" }
    : {
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
      };
  const change = (
    nextTier: Tier,
    nextAmps: number,
    mode: "amps" | "eut" = raw ? "eut" : "amps",
  ) => {
    if (
      locked() ||
      !Number.isFinite(nextAmps) ||
      nextAmps < 0 ||
      !Number.isFinite(nextAmps * getVoltageTierMaxEuT(nextTier))
    )
      return;
    onChange(nextTier, mode === "amps" ? Math.min(nextAmps, MAX_HATCH_AMPS) : nextAmps, mode);
  };
  const stepUnit = (direction: number) => {
    if (raw) {
      // Return to the remembered voltage without changing the supply.
      if (direction > 0) change(tier, amps, "amps");
      return;
    }
    const index = GT_VOLTAGE_TIERS.findIndex((t) => t.tier === tier);
    if (index === 0 && direction < 0) {
      change(tier, amps, "eut");
      return;
    }
    pickTier(GT_VOLTAGE_TIERS[Math.max(0, Math.min(GT_VOLTAGE_TIERS.length - 1, index + direction))].tier);
  };
  // Leaving raw EU/t for its own tier keeps the supply exactly; a real tier
  // change lifts a supply under one amp to one (ampsForNewTier).
  const pickTier = (nextTier: Tier) =>
    change(nextTier, nextTier === tier ? amps : ampsForNewTier(amps), "amps");
  const amount = raw ? poolEuT : amps;
  const label = raw ? "Supply EU/t" : "Hatch amps";
  const commit = () => {
    if (draft !== undefined && draft.trim()) {
      const value = Number(draft.trim().replace(/,/g, ""));
      change(tier, raw ? value / getVoltageTierMaxEuT(tier) : value);
    }
    setDraft(undefined);
  };
  const stepAmount = (direction: -1 | 1, step = 1) => {
    const next = raw ? Math.max(0, amount + direction * step) : stepWholeAmp(amount, direction, step);
    change(tier, raw ? next / getVoltageTierMaxEuT(tier) : next);
  };
  const openTouchPanel = () => {
    if (!touchPress.current && !isTouchPointer() && !isCompactViewport()) return false;
    if (!locked()) setTouchOpen(true);
    return true;
  };
  const touchButton = "min-h-11 min-w-11 border border-line bg-surface-raised px-3 font-semibold disabled:opacity-40";
  return (<>
    {touchOpen ? <TouchPowerPanel onClose={() => { setTouchOpen(false); setDraft(undefined); }}>
      <div className="mb-4 grid gap-3" data-touch-power-controls>
        <label className="grid gap-1">{label}
          <input aria-label={label} inputMode="decimal" className="min-h-11 w-full border border-line bg-surface px-3 text-base"
            value={draft ?? String(amount)} onChange={(event) => setDraft(event.target.value)}
            onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
        <div className="grid grid-cols-4 gap-2">
          {[-10, -1, 1, 10].map(step => <button key={step} className={touchButton}
            aria-label={`${step > 0 ? "Increase" : "Decrease"} ${raw ? "EU/t" : "amps"} by ${Math.abs(step)}`}
            onClick={() => stepAmount(step > 0 ? 1 : -1, Math.abs(step))}>{step > 0 ? "+" : "−"}{Math.abs(step)}</button>)}
        </div>
        <label className="grid gap-1">Power input unit
          <select aria-label="Power input unit" className="min-h-11 w-full border border-line bg-surface px-3 text-base"
            value={raw ? "eut" : tier} onChange={(event) => {
              if (event.target.value === "eut") change(tier, amps, "eut");
              else pickTier(event.target.value as Tier);
            }}>
            <option value="eut">EU/t</option>
            {GT_VOLTAGE_TIERS.map(value => <option key={value.tier} value={value.tier}>{value.tier}</option>)}
          </select>
        </label>
      </div>
      <PowerReadout compact recipe={recipe} node={node} mode={mode}
        plannedEuT={plannedEuT} utilization={utilization} sharedAverageEuT={sharedAverageEuT} shared={shared} />
    </TouchPowerPanel> : null}
    <MinecraftTooltip
      placement="above-card"
      companion={() => <PowerControlsGuide raw={raw} active={activeControl} />}
      content={() => (
        <PowerReadout
          recipe={recipe}
          node={node}
          mode={mode}
          plannedEuT={plannedEuT}
          utilization={utilization}
          sharedAverageEuT={sharedAverageEuT}
          shared={shared}
        />
      )}
    >
      <div
        className="flex"
        data-power-controls
        onPointerDown={(e) => { touchPress.current = e.pointerType === "touch" || e.pointerType === "pen"; e.stopPropagation(); }}
        onClick={(e) => e.stopPropagation()}
      >
        {draft !== undefined ? (
          <input
            autoFocus
            onMouseEnter={() => setActiveControl("amount")}
            aria-label={label}
            inputMode="decimal"
            value={draft}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(undefined);
              }
            }}
            className={`${chip} w-[64px] outline-none`}
            style={style}
          />
        ) : (
          <button
            aria-label={label}
            onMouseEnter={() => setActiveControl("amount")}
            className={`${chip} w-[64px]`}
            style={style}
            onClick={() => {
              if (openTouchPanel()) return;
              if (!locked()) setDraft(String(amount));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              stepAmount(-1);
            }}
            onWheel={(e) => {
              e.stopPropagation();
              if (e.shiftKey && !e.ctrlKey && !e.metaKey && !raw) {
                change(tier, stepPowerOfFourAmps(amps, e.deltaY < 0 ? 1 : -1));
                return;
              }
              const step = (e.shiftKey ? 100 : 1) * (e.ctrlKey || e.metaKey ? 10 : 1);
              stepAmount(e.deltaY < 0 ? 1 : -1, step);
            }}
          >
            {formatCompact(amount)}
            {raw ? "" : "A"}
          </button>
        )}
        <button
          aria-label="Power input unit"
          onMouseEnter={() => setActiveControl("tier")}
          className={`${chip} w-[64px] shrink-0`}
          style={{ ...style, textDecoration: !raw && color.underline ? "underline" : undefined }}
          onClick={() => { if (!openTouchPanel()) stepUnit(1); }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            stepUnit(-1);
          }}
          onWheel={(e) => {
            e.stopPropagation();
            stepUnit(e.deltaY < 0 ? 1 : -1);
          }}
        >
          {raw ? "EU/t" : tier}
        </button>
      </div>
    </MinecraftTooltip>
    </>
  );
}
