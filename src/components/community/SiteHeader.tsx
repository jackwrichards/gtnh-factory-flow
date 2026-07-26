import Link from "next/link";

/** Shared top navigation for the marketing and community pages. */
export function SiteHeader({ active }: { active: "home" | "community" }) {
  const linkClass = (isActive: boolean) =>
    `rounded px-3 py-1.5 text-sm font-medium ${
      isActive ? "bg-surface-raised text-fg" : "text-fg-subtle hover:text-fg"
    }`;

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-bold tracking-tight">
          GTNH <span className="text-cyan-500">Factory Flow</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/" className={linkClass(active === "home")}>
            Home
          </Link>
          <Link href="/community" className={linkClass(active === "community")}>
            Community
          </Link>
          <Link
            href="/app"
            className="ml-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            Open the planner
          </Link>
        </nav>
      </div>
    </header>
  );
}
