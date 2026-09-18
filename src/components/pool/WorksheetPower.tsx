import type { MachineListEntry } from "@/lib/model/machine-list";
import { formatPowerValue } from "@/lib/model/resources";
import { powerDisplayFromEuT, powerDisplaySuffix, rateSuffixForKind } from "@/lib/model/rate-unit";
import { Zap } from "lucide-react";
import { formatSlotRateBare } from "../flow/flow-explainers";

/** Compact headline with the same complete average/peak breakdown available by click, keyboard, or touch. */
export function WorksheetPower({
  entries,
  id,
  compact = false,
}: {
  entries: MachineListEntry[];
  id?: string;
  compact?: boolean;
}) {
  const sum = (key: "euT" | "avgEuT" | "madeEuT" | "avgMadeEuT" | "steamLs" | "avgSteamLs") =>
    entries.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  const rows = [
    { label: "Used", average: sum("avgEuT"), peak: sum("euT") },
    { label: "Made", average: sum("avgMadeEuT"), peak: sum("madeEuT") },
    { label: "Net", average: sum("avgMadeEuT") - sum("avgEuT"), peak: sum("madeEuT") - sum("euT") },
    ...(entries.some((entry) => entry.steamLs !== undefined)
      ? [{ label: "Steam", average: sum("avgSteamLs"), peak: sum("steamLs"), steam: true }]
      : []),
  ];
  const format = (value: number) => formatPowerValue(powerDisplayFromEuT(Math.abs(value)));
  const table = (
    <table className="pool-summary-table pool-power-table" aria-label="Pool power totals">
      <thead>
        <tr>
          <th />
          <th>Average</th>
          <th>Peak</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {[row.average, row.peak].map((value, index) => {
              const steam = "steam" in row && row.steam;
              const number = steam ? formatSlotRateBare(value, "fluid") : format(value);
              const signed = row.label === "Net" && number !== "0" ? (value < 0 ? "−" : "+") : "";
              return (
                <td key={index}>
                  <span
                    className={`inspector-resource-net pool-balance-rate ${row.label === "Net" ? (value < 0 ? "pool-flow-input" : value > 0 ? "pool-flow-output" : "") : ""}`}
                  >
                    {signed}
                    {number}
                    <span className="inspector-unit">
                      {steam ? rateSuffixForKind("fluid").trim() : powerDisplaySuffix()}
                    </span>
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (compact)
    return (
      <section id={id} className="pool-compact-power" aria-label="Pool power summary">
        <details
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            className="pool-power-headline"
            title="Power breakdown"
            aria-label={`Average power used ${format(rows[0].average)} ${powerDisplaySuffix()}, peak ${format(rows[0].peak)} ${powerDisplaySuffix()}; made ${format(rows[1].average)} ${powerDisplaySuffix()}`}
          >
            <Zap size={12} aria-hidden />
            <strong>{format(rows[0].average)}</strong>
            <small>{powerDisplaySuffix()}</small>
            {rows[0].peak !== rows[0].average ? <small>peak {format(rows[0].peak)}</small> : null}
            {rows[1].average > 0 || rows[1].peak > 0 ? (
              <span className="pool-flow-output">
                +{format(rows[1].average)}
                <small>{powerDisplaySuffix()}</small>
              </span>
            ) : null}
            {rows[3] ? (
              <span>
                {formatSlotRateBare(rows[3].average, "fluid")}
                <small>{rateSuffixForKind("fluid").trim()} steam</small>
              </span>
            ) : null}
          </summary>
          <div className="pool-power-breakdown">{table}</div>
        </details>
      </section>
    );
  return (
    <section id={id} className="pool-sheet-power" aria-label="Pool power summary">
      <div className="pool-sheet-resource-heading">
        <h3>Power</h3>
      </div>
      <div className="pool-resources-scroll">{table}</div>
    </section>
  );
}
