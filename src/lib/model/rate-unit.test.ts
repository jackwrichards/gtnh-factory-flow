import { afterEach, describe, expect, it } from "vitest";

import {
    rateUnitMultiplier,
    rateUnitSuffix,
    setActiveRateUnit,
} from "./rate-unit";

afterEach(() => {
    setActiveRateUnit("second");
});

describe("rate units", () => {
    it("converts per-second rates to per-tick rates", () => {
        setActiveRateUnit("tick");

        expect(rateUnitMultiplier()).toBe(1 / 20);
        expect(rateUnitSuffix(false)).toBe("/t");
        expect(rateUnitSuffix(true)).toBe(" L/t");
    });
});