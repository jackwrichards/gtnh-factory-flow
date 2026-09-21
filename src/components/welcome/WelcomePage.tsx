"use client";

import {
  Download,
  Factory,
  Library,
  Plus,
  Search,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FLUID_ICON_SCALE, ResourceIcon } from "@/components/nei/ResourceIcon";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { queryRecipeDatasetResources } from "@/lib/datasets/browser-loader";
import { listCommunityPlans } from "@/lib/community/client";
import type { CommunityPlanSummary } from "@/lib/community/types";
import type { EntryIcon } from "@/lib/model/types";
import { openCommunityPost } from "@/lib/community/open-post";
import { openLibrary } from "@/lib/library/library-tab";
import { openSidebarTab } from "@/lib/sidebar-tab";
import { APP_VERSION } from "@/lib/version";
import { leaveWelcomeTab, setWelcomeOnStartup, useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { writeWorkspaceView } from "@/lib/workspace-view";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { WelcomeBackdrop } from "./WelcomeBackdrop";

/**
 * The Welcome tab: the first thing a visitor sees, and the place a regular
 * comes back to for their designs and the community's.
 *
 * It COVERS the board (see FactoryPlannerApp) rather than replacing it, over
 * a quiet ASCII backdrop that keeps to the corners. The content is one
 * column, kept short: the name and the three ways to start, your designs and
 * the community's newest setups. Every pick steps off the tab, and the
 * checkbox at the foot is how a regular stops arriving here.
 *
 * There is no "new in vX" section any more (Jack, 2026-09-08): the player
 * facing release notes are available from the header version chip. Returning
 * visitors are never interrupted by an automatic release popup.
 */

const COMMUNITY_TILE_COUNT = 15;
/** How many of the pack's most-used items the backdrop gets to drift. */
const BACKDROP_ICON_COUNT = 60;

/**
 * The most-used items in the loaded pack, as sprite URLs for the backdrop.
 * Empty until the dataset is known; the backdrop runs without them.
 */
function useBackdropIcons(): string[] {
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const manifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const versionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const version = useMemo(
    () => manifest?.versions.find((entry) => entry.id === versionId),
    [manifest?.versions, versionId],
  );
  const [icons, setIcons] = useState<string[]>([]);
  useEffect(() => {
    if (!version) {
      return;
    }
    const controller = new AbortController();
    queryRecipeDatasetResources(
      manifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      version,
      { query: "", offset: 0, limit: BACKDROP_ICON_COUNT, kind: "item", sort: "popular" },
      { signal: controller.signal },
    )
      .then((result) => {
        const paths = result.resources
          .map((entry) => entry.iconPath)
          .filter((path): path is string => Boolean(path));
        setIcons(paths);
      })
      .catch(() => {
        // The backdrop is decoration; a failed list leaves it as glyphs.
      });
    return () => controller.abort();
  }, [manifestUrl, version]);
  return icons;
}

export function WelcomePage() {
  const welcome = useWelcomeTab();
  const addDesign = useDesignStore((state) => state.addDesign);
  const backdropIcons = useBackdropIcons();

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-canvas text-fg">
      <WelcomeBackdrop icons={backdropIcons} />
      {/* A dark wash under the words so the backdrop stays a backdrop; the
          edges are left clear so the animation shows through on both sides
          of the column. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 70% at 50% 40%, rgba(16,20,25,0.92) 0%, rgba(16,20,25,0.7) 55%, rgba(16,20,25,0.05) 100%)",
        }}
      />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-6 pb-8 pt-8 compact:px-4 compact:pt-6">
          <header className="flex flex-col items-start gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-[32px] font-black leading-none tracking-tight text-white compact:text-[26px]">
                <span className="text-cyan-300">GTNH</span> Planner
              </h1>
              <span className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-fg-muted">
                v{APP_VERSION}
              </span>
            </div>
            <p className="max-w-[600px] text-[13px] leading-relaxed text-fg-subtle">
              Draw a GregTech: New Horizons factory as a flowchart. Every card is a
              real recipe, every wire carries a real rate, and the board tells you
              what starves, what clogs and what to build.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <PrimaryButton
                icon={Plus}
                onClick={() => {
                  // Step off first: adding a design does not, and the new
                  // tab would otherwise sit under this page unseen.
                  leaveWelcomeTab();
                  void addDesign();
                }}
              >
                New design
              </PrimaryButton>
              <SecondaryButton
                icon={Factory}
                onClick={() => openLibrary({ kind: "public" })}
              >
                Browse shared setups
              </SecondaryButton>
              <SecondaryButton
                icon={Search}
                onClick={() => {
                  writeWorkspaceView({ leftPanelOpen: true });
                  openSidebarTab("items", { focusSearch: true });
                }}
              >
                Find a recipe
              </SecondaryButton>
              {/* Your own designs live on the shelf now, not on this page. */}
              <SecondaryButton icon={Library} onClick={() => openLibrary()}>
                Your library
              </SecondaryButton>
            </div>
          </header>

          <CommunityShelf />

          <footer className="border-t border-line pt-3">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-fg-muted hover:text-fg">
              <input
                type="checkbox"
                checked={welcome.showOnStartup}
                onChange={(event) => setWelcomeOnStartup(event.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Open on this tab when I arrive
            </label>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
      {children}
    </h2>
  );
}

function PrimaryButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof Plus;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 border-2 border-cyan-300 bg-cyan-400 px-3.5 text-[13px] font-bold text-[#062026] shadow-[4px_4px_0_rgba(0,0,0,0.45)] hover:bg-cyan-300 active:translate-x-px active:translate-y-px active:shadow-[2px_2px_0_rgba(0,0,0,0.45)]"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </button>
  );
}

function SecondaryButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof Plus;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 border-2 border-line-strong bg-[#151a21]/85 px-3.5 text-[13px] font-bold text-fg-subtle shadow-[4px_4px_0_rgba(0,0,0,0.45)] hover:border-cyan-500/60 hover:text-white active:translate-x-px active:translate-y-px active:shadow-[2px_2px_0_rgba(0,0,0,0.45)]"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </button>
  );
}

/** A saved face, drawn oversized so the art fills the box the way tabs do. */
function Face({ icon, size }: { icon: EntryIcon | undefined; size: number }) {
  const drawable = Boolean(icon && (icon.iconPath || icon.iconAtlas || icon.kind === "fluid"));
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {drawable && icon ? (
        <ResourceIcon
          resource={{
            id: icon.resourceId,
            kind: icon.kind,
            amount: 1,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            iconAtlas: icon.iconAtlas,
            dominantColor: icon.dominantColor,
          }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={
            icon.kind === "fluid" ? Math.round((size - 8) / FLUID_ICON_SCALE) : (size - 8) * 2
          }
          className="!h-full !w-full"
        />
      ) : (
        <Factory className="h-1/2 w-1/2 text-[#3d4a58]" />
      )}
    </span>
  );
}

/** The community's newest setups, opening in a tab of their own. */
function CommunityShelf() {
  const [plans, setPlans] = useState<CommunityPlanSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listCommunityPlans({ sort: "new", pageSize: COMMUNITY_TILE_COUNT })
      .then((response) => {
        if (!cancelled) {
          setPlans(response.plans.slice(0, COMMUNITY_TILE_COUNT));
        }
      })
      .catch((listError: unknown) => {
        if (!cancelled) {
          setError(listError instanceof Error ? listError.message : "Could not reach the shelf.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (plan: CommunityPlanSummary) => {
    setBusyId(plan.id);
    try {
      await openCommunityPost({ id: plan.id, name: plan.name, isMine: plan.isMine === true, authorName: plan.authorName });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Opening the setup failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>
        <Factory className="h-3.5 w-3.5 text-cyan-300" aria-hidden />
        New from the community
      </SectionTitle>
      {error ? <p className="text-[12px] text-amber-300">{error}</p> : null}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {(plans ?? Array.from({ length: COMMUNITY_TILE_COUNT }, () => undefined)).map(
          (plan, index) =>
            plan ? (
              <button
                key={plan.id}
                type="button"
                disabled={busyId !== undefined}
                onClick={() => void open(plan)}
                className={[
                  "group flex items-center gap-2 border border-line bg-[#151a21]/80 px-2 py-1 text-left hover:border-cyan-500/60 hover:bg-[#182029] disabled:opacity-60",
                  busyId === plan.id ? "animate-pulse" : "",
                ].join(" ")}
              >
                <Face icon={plan.icon} size={44} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-bold text-fg group-hover:text-white">
                    {plan.name}
                  </span>
                  <span className="flex items-center gap-2 truncate text-[11px] text-fg-muted">
                    <span className="truncate">
                      {plan.authorName ? plan.authorName : "anonymous"}
                      {plan.highestTier ? ` · ${plan.highestTier}` : ""}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <ThumbsUp className="h-3 w-3" aria-hidden />
                      {plan.score}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <Download className="h-3 w-3" aria-hidden />
                      {plan.downloads}
                    </span>
                  </span>
                </span>
              </button>
            ) : (
              <div
                key={index}
                aria-hidden
                className="h-[54px] animate-pulse border border-line bg-[#151a21]/60"
              />
            ),
        )}
      </div>
    </section>
  );
}
