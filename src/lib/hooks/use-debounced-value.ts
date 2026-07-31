"use client";

import { useEffect, useState } from "react";

/**
 * Trails `value` by `delayMs`, so expensive consumers react to a settled value
 * instead of to every keystroke.
 *
 * Clearing is not delayed: emptying a filter should restore the full list at
 * once, and there is no work to save by waiting.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutMs = typeof value === "string" && value.length === 0 ? 0 : delayMs;
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}
