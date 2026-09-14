import { formatCompact, formatPowerValue } from "@/lib/model/resources";
import { rateMultiplierForKind } from "@/lib/model/rate-unit";

/** Shared signed boundary readings: red imports, green exports, unsigned zero. */
export function formatSignedRate(perSecond: number, kind: string, sign: number): string {
  const value = Math.abs(perSecond) * rateMultiplierForKind(kind);
  const text = kind === "power" ? formatPowerValue(value) : formatCompact(value);
  return text === "0" ? text : (sign < 0 ? "−" : sign > 0 ? "+" : "") + text;
}
