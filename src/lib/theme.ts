export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "gtnh-planner-theme";
export const THEME_ATTRIBUTE = "data-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function prefersDarkTheme(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readStoredTheme(): Theme | undefined {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : undefined;
  } catch {
    // Storage can be unavailable in private mode or with cookies blocked.
    return undefined;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persisting the choice is best-effort; the theme still applies this session.
  }
}

/**
 * The theme already applied to the document by the pre-hydration script, which
 * is the only source of truth that survives SSR without a flash.
 */
export function readAppliedTheme(): Theme {
  const applied = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return isTheme(applied) ? applied : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
}

/**
 * Runs synchronously in <head> so the correct theme is on <html> before the
 * first paint. Without this the page renders light and then snaps to dark.
 *
 * This intentionally makes the server and client markup differ on <html>, which
 * is why the element carries suppressHydrationWarning.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t);}catch(e){}})();`;
