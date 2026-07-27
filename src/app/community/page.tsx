import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { CommunityBrowser } from "@/components/community/CommunityBrowser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community plans | GTNH Factory Flow",
  description:
    "Browse, preview, and download GregTech: New Horizons factory plans shared by the community. Sort by votes, downloads, machines, tier, and power.",
};

export default function CommunityPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <AppHeader page="community" />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 pt-6">
          <h1 className="text-xl font-bold">Community plans</h1>
          <p className="mt-1 text-sm text-fg-subtle">
            Factories shared by other players. Preview the stats, grab the JSON, or open a plan
            straight in the editor — and share your own from the planner&apos;s Share button.
          </p>
        </div>
        {/* Suspense boundary is required by useSearchParams inside the browser. */}
        <Suspense>
          <CommunityBrowser />
        </Suspense>
      </main>
    </div>
  );
}
