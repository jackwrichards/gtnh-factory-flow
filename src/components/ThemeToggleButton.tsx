"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { useThemeStore } from "@/store/theme-store";

/** Light/dark switch; lives in the shared header so every page has it. */
export function ThemeToggleButton() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const syncThemeFromDocument = useThemeStore((state) => state.syncThemeFromDocument);

  useEffect(() => {
    syncThemeFromDocument();
  }, [syncThemeFromDocument]);

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised"
    >
      {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </button>
  );
}
