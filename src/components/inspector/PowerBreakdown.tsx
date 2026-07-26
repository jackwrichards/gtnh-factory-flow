"use client";

import { useMemo, useState } from "react";
import { formatRate } from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import { buildPowerByMachine, buildPowerByTier, type PowerSlice } from "./power-breakdown";

/**
 * Ordinal ramp for the tier bar: one hue, light to dark, defined in globals.css
 * so light and dark swap without this component knowing which is active.
 */
const ORDINAL_RAMP = [
  "var(--viz-ordinal-1)",
  "var(--viz-ordinal-2)",
  "var(--viz-ordinal-3)",
  "var(--viz-ordinal-4)",
  "var(--viz-ordinal-5)",
];

type PowerView = "tier" | "machine";

/**
 * Spreads `count` ordered slices across the ramp so the lowest and highest tier
 * always land on its ends, whatever the plan happens to contain. A plan using
 * three tiers gets three well-separated steps rather than the first three.
 *
 * The trade-off: a step means "this tier's position among the tiers present",
 * not "this tier", so editing a plan until a tier disappears resteps the rest.
 * That is the right call here because the ramp's job is to show the ordering at
 * a glance, and the legend names every tier next to its swatch — nothing depends
 * on remembering that a particular blue meant IV. Keying colour to the absolute
 * tier index instead would be stable but would squash the two or three adjacent
 * tiers a real plan uses into neighbouring steps, which is where separation
 * actually matters.
 */
function rampColor(index: number, count: number): string {
  if (count <= 1) {
    return ORDINAL_RAMP[ORDINAL_RAMP.length - 1];
  }

  return ORDINAL_RAMP[Math.round((index * (ORDINAL_RAMP.length - 1)) / (count - 1))];
}

function formatShare(share: number): string {
  const percent = share * 100;
  return `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function sliceTitle(slice: PowerSlice): string {
  return `${slice.label} — ${formatRate(slice.euT, 0)} EU/t (${formatShare(slice.share)})`;
}

export function PowerBreakdown() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const [view, setView] = useState<PowerView>("tier");

  const tiers = useMemo(() => buildPowerByTier(project, result), [project, result]);
  const machines = useMemo(() => buildPowerByMachine(project, result), [project, result]);
  const slices = view === "tier" ? tiers : machines;

  return (
    <section className="shrink-0 rounded border border-line bg-surface-raised p-2">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Power</h2>
        <span className="text-base font-bold tabular-nums text-fg">
          {formatRate(result.totalEuT, 0)}
        </span>
        <span className="text-[11px] font-semibold text-fg-muted">EU/t</span>

        <div className="ml-auto flex overflow-hidden rounded border border-line">
          {(["tier", "machine"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={[
                "px-1.5 py-0.5 text-[11px] font-semibold capitalize",
                view === option
                  ? "bg-cyan-100 text-cyan-900 dark:bg-cyan-500/25 dark:text-cyan-50"
                  : "text-fg-muted hover:bg-surface-sunken hover:text-fg",
              ].join(" ")}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {slices.length === 0 ? (
        <p className="mt-1.5 text-xs text-fg-muted">No machines drawing power yet.</p>
      ) : view === "tier" ? (
        <TierBar slices={tiers} />
      ) : (
        <MachineBars slices={machines} />
      )}
    </section>
  );
}

/**
 * Part-to-whole across an ordered scale, so one stacked bar rather than a row of
 * separate bars: the reader's question is what share of the load each voltage
 * line carries. Segments are separated by a 2px gap in the surface colour rather
 * than a stroke, so neighbouring ramp steps read apart without extra ink.
 */
function TierBar({ slices }: { slices: PowerSlice[] }) {
  return (
    <>
      {/*
        One tier means the bar would be a single full-width block restating the
        legend row below it, so it is dropped — the row already reads
        "IV · 6.1k · 100%", which is the whole chart.
      */}
      {slices.length > 1 ? (
        <div className="mt-2 flex h-3.5 w-full gap-[2px]">
          {slices.map((slice, index) => (
            <div
              key={slice.key}
              title={sliceTitle(slice)}
              style={{
                flexGrow: slice.share,
                flexBasis: 0,
                backgroundColor: rampColor(index, slices.length),
              }}
              className={[
                "h-full min-w-[3px]",
                index === 0 ? "rounded-l-[4px]" : "",
                index === slices.length - 1 ? "rounded-r-[4px]" : "",
              ].join(" ")}
            />
          ))}
        </div>
      ) : null}

      {/* Doubles as the table view: every value is legible without reading colour. */}
      <ul className="mt-1.5 space-y-0.5">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2 text-[11px] leading-tight">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: rampColor(index, slices.length) }}
            />
            <span className="font-semibold text-fg">{slice.label}</span>
            <span className="ml-auto tabular-nums text-fg-muted">
              {formatRate(slice.euT, 0)}
            </span>
            <span className="w-10 text-right tabular-nums text-fg-subtle">
              {formatShare(slice.share)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Ranked magnitude, so plain bars from a common baseline. Machine names are
 * nominal — no order to encode — so every bar wears the same hue and length
 * alone carries the comparison; colouring them individually would spend the
 * identity channel re-encoding what the bar already shows.
 */
function MachineBars({ slices }: { slices: PowerSlice[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {slices.map((slice) => (
        <li key={slice.key} title={sliceTitle(slice)}>
          <div className="flex items-baseline gap-2 text-[11px] leading-tight">
            <span className="truncate text-fg">{slice.label}</span>
            <span className="ml-auto shrink-0 font-semibold tabular-nums text-fg-muted">
              {formatRate(slice.euT, 0)}
            </span>
          </div>
          <div
            style={{
              width: `${Math.max(slice.share * 100, 1)}%`,
              backgroundColor: "var(--viz-series-1)",
            }}
            className="mt-0.5 h-2 rounded-r-[4px]"
          />
        </li>
      ))}
    </ul>
  );
}
