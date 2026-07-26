import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Slim top bar for the community hub with a one-click way back to the planner. */
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2.5">
        <span className="text-base font-bold tracking-tight">
          GTNH <span className="text-cyan-500">Factory Flow</span>
          <span className="ml-2 text-sm font-medium text-fg-muted">Community</span>
        </span>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-500"
        >
          <ArrowLeft className="h-4 w-4" /> Back to planner
        </Link>
      </div>
    </header>
  );
}
