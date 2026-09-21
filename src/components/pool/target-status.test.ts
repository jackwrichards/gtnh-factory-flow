import { expect, it } from "vitest";
import { targetStatus } from "./target-status";
import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
const storage: FactoryStorage = { id: "goal", kind: "item", resourceId: "ore", position: { x: 0, y: 0 }, targetPerSecond: 10 };
const result: StorageThroughputResult = { storageId: "goal", kind: "item", resourceId: "ore", producedPerSecond: 10, consumedPerSecond: 0, storedAmount: 0, capacity: 0, netPerSecond: 10, status: "filling" };
it("separates allowed overproduction from a failed exact target", () => {
  const excess = { ...result, producedPerSecond: 12 };
  expect(targetStatus(storage, "product", excess)).toMatchObject({ label: "Above requested rate", tone: "met" });
  expect(targetStatus({ ...storage, targetMode: "exact" }, "product", { ...excess, targetUnreachable: true })).toMatchObject({ label: "Rate limit exceeded", explain: true });
});
it("uses consumption for negative input goals", () => {
  expect(targetStatus({ ...storage, targetPerSecond: -10 }, "product", { ...result, consumedPerSecond: 3, targetUnreachable: true })).toMatchObject({ label: "Below requested rate", explain: true });
});
it("does not mistake unused capacity for an unmet maximum", () => {
  expect(targetStatus({ ...storage, targetMode: "at-most" }, "product", { ...result, producedPerSecond: 0 }).label).toBe("Within rate limit");
});
it("distinguishes unset, ignored and zero targets", () => {
  expect(targetStatus({ ...storage, targetPerSecond: undefined }, "product", result).label).toBe("No rate set");
  expect(targetStatus({ ...storage, targetMode: "ignore" }, "product", { ...result, targetUnreachable: true }).label).toBe("Rate not enforced");
  expect(targetStatus({ ...storage, targetPerSecond: 0, targetMode: "exact" }, "product", { ...result, producedPerSecond: 0 }).label).toBe("Requested rate met");
});
it("does not present stale results as a current verdict", () => {
  expect(targetStatus(storage, "product", result, true).label).toBe("Calculating…");
  expect(targetStatus(storage, "product", result, true, true).label).toBe("Waiting to recalculate");
  expect(targetStatus(storage, "product", undefined).tone).toBe("muted");
});
it("does not label numerical noise as excess production", () => {
  expect(targetStatus(storage, "product", { ...result, producedPerSecond: 10.000001 }).label).toBe("Requested rate met");
});
