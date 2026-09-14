import type { MachineListEntry } from "@/lib/model/machine-list";
import { formatPowerValue } from "@/lib/model/resources";
import { powerDisplayFromEuT, powerDisplaySuffix, rateSuffixForKind } from "@/lib/model/rate-unit";
import { formatSlotRateBare } from "../flow/flow-explainers";

/** The same per-card peak/average totals as the inspector, never filtered by search. */
export function WorksheetPower({ entries }: { entries: MachineListEntry[] }) {
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
  return (
    <section className="pool-sheet-power" aria-label="Pool power summary">
      <div className="pool-sheet-resource-heading">
        <h3>Power</h3>
      </div>
      <div className="pool-resources-scroll">
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
                  const number = steam
                    ? formatSlotRateBare(value, "fluid")
                    : formatPowerValue(powerDisplayFromEuT(Math.abs(value)));
                  const signed =
                    row.label === "Net" && number !== "0" ? (value < 0 ? "−" : "+") : "";
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
      </div>
    </section>
  );
}
