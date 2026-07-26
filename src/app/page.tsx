import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/community/SiteHeader";

export const metadata: Metadata = {
  title: "GTNH Factory Flow | Plan GregTech: New Horizons factories",
  description:
    "A free flowchart planner and throughput calculator for GregTech: New Horizons. Design production chains, balance machine ratios, and share plans with the community.",
};

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: "Real GTNH recipes",
    body: "Recipes, machines, and NEI layouts come from datasets exported straight out of the pack — including multiblocks, coil and casing tiers, parallels, and ore dictionary handling.",
  },
  {
    title: "Live throughput solver",
    body: "Every edit recalculates rates end-to-end: see per-second flows on every link, spot bottlenecks and starved machines instantly, and let the optimizer suggest machine counts.",
  },
  {
    title: "Overclocking & tiers",
    body: "Set voltage tiers per machine, stack config dimensions like heating coils and pipe casings, and watch EU/t and durations follow GregTech overclocking rules.",
  },
  {
    title: "Annotate your designs",
    body: "Color-code machines with the paint brush, group sections with boxes, point things out with arrows, and leave text notes right on the canvas.",
  },
  {
    title: "Import & export anywhere",
    body: "Plans round-trip as JSON, SVG, or PNG images with the full plan embedded inside — drop a screenshot into Discord and anyone can import it back.",
  },
  {
    title: "Community plan hub",
    body: "Share your factory with one click, browse what others built, sort by votes, downloads, power, or tier, and open any plan straight in the editor.",
  },
];

const GUIDE_STEPS: Array<{ title: string; body: string }> = [
  {
    title: "1 · Find a recipe",
    body: "Search the recipe browser on the left for the item you want to produce, then click a recipe to drop it on the canvas as a machine node.",
  },
  {
    title: "2 · Chain machines together",
    body: "Drag from an output slot to another machine's input slot to link them. Drag an output onto empty canvas to create a storage drawer for buffering.",
  },
  {
    title: "3 · Balance the line",
    body: "Rate labels on every link show live flow. Starved links go dashed; the wand button sets every machine count to its ideal ratio in one click.",
  },
  {
    title: "4 · Tune tiers and configs",
    body: "Click a machine's tier chip to overclock it. Multiblocks expose their coils, casings, and parallels as config slots on the node.",
  },
  {
    title: "5 · Annotate and share",
    body: "Paint, box, and label sections of your factory, then use the Share button to publish it to the community hub — or export a PNG that carries the whole plan inside it.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <SiteHeader active="home" />

      <main className="flex-1">
        <section className="border-b border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center">
            <h1 className="mx-auto max-w-3xl text-3xl font-black leading-tight sm:text-4xl">
              Plan your <span className="text-cyan-500">GregTech: New Horizons</span> factory
              before you place a single machine
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-fg-subtle">
              GTNH Factory Flow is a free flowchart planner with a live throughput solver, real
              pack recipes, GregTech overclocking, and a community hub full of shared designs.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app"
                className="rounded border border-cyan-700 bg-cyan-600 px-5 py-2.5 font-semibold text-white hover:bg-cyan-500"
              >
                Start planning — it&apos;s free
              </Link>
              <Link
                href="/community"
                className="rounded border border-line-strong px-5 py-2.5 font-medium hover:bg-surface-raised"
              >
                Browse community plans
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 className="text-xl font-bold">What it does</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded border border-line bg-surface p-4">
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-fg-subtle">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-12">
            <h2 className="text-xl font-bold">Quick start guide</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {GUIDE_STEPS.map((step) => (
                <div key={step.title} className="rounded border border-line bg-canvas p-4">
                  <h3 className="font-semibold text-cyan-500">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-fg-subtle">{step.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-fg-muted">
              Tips: <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> undo and redo, <kbd>Delete</kbd> removes
              the selection, <kbd>Esc</kbd> cancels any active tool. Plans autosave in your
              browser across visits.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-fg-muted">
          <p>
            Open source under the MIT license · based on GTNH Factory Flow by Samiracle64. Not
            affiliated with the GTNH team or Mojang.
          </p>
          <a
            href="https://github.com/jackwrichards/gtnh-factory-hub"
            className="underline hover:text-fg"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
