"use client";

import { PencilRuler, Users } from "lucide-react";
import Link from "next/link";
import { AccountMenu } from "./community/AccountMenu";
import { BoardActions } from "./BoardActions";
import { ThemeToggleButton } from "./ThemeToggleButton";

/**
 * The one top bar for the whole app. Title, theme, and account are always
 * there; the board actions only exist on the editor; the nav button flips
 * between Community and Editor so switching feels like changing panels, not
 * changing sites.
 */
export function AppHeader({ page }: { page: "editor" | "community" }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5">
      <h1 className="text-sm font-bold tracking-tight">
        GTNH <span className="text-cyan-500">Planner</span>
        {page === "community" ? (
          <span className="ml-2 font-medium text-fg-muted">Community</span>
        ) : null}
      </h1>
      <div className="flex items-center gap-2">
        {page === "editor" ? <BoardActions /> : null}
        <ThemeToggleButton />
        {page === "editor" ? (
          <Link
            href="/community"
            className="inline-flex h-7 items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Users className="h-3.5 w-3.5" /> Community
          </Link>
        ) : (
          <Link
            href="/"
            className="inline-flex h-7 items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <PencilRuler className="h-3.5 w-3.5" /> Editor
          </Link>
        )}
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <AccountMenu />
      </div>
    </header>
  );
}
