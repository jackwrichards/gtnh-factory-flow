"use client";

import { create } from "zustand";
import {
  applyTheme,
  readAppliedTheme,
  storeTheme,
  type Theme,
} from "@/lib/theme";

interface ThemeStore {
  theme: Theme;
  /** Adopts the theme the pre-hydration script already put on <html>. */
  syncThemeFromDocument: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // Matches the server-rendered markup; corrected on mount by
  // syncThemeFromDocument so hydration never sees a mismatch here.
  theme: "light",
  syncThemeFromDocument: () => set({ theme: readAppliedTheme() }),
  setTheme: (theme) => {
    applyTheme(theme);
    storeTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
