import { rateMultiplierForKind, rateSuffixForKind } from "@/lib/model/rate-unit";
import { formatPowerValue } from "@/lib/model/resources";
import { formatEnergyPerUnitParts, formatSlotRateBare } from "../flow/flow-explainers";

/** Display-only floor, applied after converting into the selected unit. */
export function formatPoolRateBare(value: number, kind = "item"): string {
  const shown = value * rateMultiplierForKind(kind);
  if (kind !== "power" && shown !== 0 && Math.abs(shown) < 0.00001) {
    return shown < 0 ? ">-.00001" : "<.00001";
  }
  return compactBound(formatSlotRateBare(value, kind));
}

export function formatPoolRate(value: number, kind: string): string {
  return formatPoolRateBare(value, kind) + rateSuffixForKind(kind);
}

export function formatPoolSignedRate(value: number, kind: string, sign: number): string {
  const text = formatPoolRateBare(Math.abs(value), kind);
  return text === "0" ? text : (sign < 0 ? "−" : sign > 0 ? "+" : "") + text;
}

function compactBound(text: string): string {
  return text.replace(/^([<>]-?)0\./, "$1.");
}

export function formatPoolPowerValue(value: number): string {
  return compactBound(formatPowerValue(value));
}

export function formatPoolEnergyPerUnitParts(value: number, kind: string) {
  const parts = formatEnergyPerUnitParts(value, kind);
  return { ...parts, value: compactBound(parts.value) };
}
