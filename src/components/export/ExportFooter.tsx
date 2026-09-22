"use client";

import type { CommunityPlanStats, EntryIcon, PlanResourceStat } from "@/lib/community/types";
import { formatSlotRate } from "@/components/flow/flow-explainers";
import { TierBadge } from "@/components/shelf-cards";
import { fluidArtPixels, isSwatchFluid, ResourceIcon } from "@/components/nei/ResourceIcon";

/**
 * The trim under an exported board image: the plan's face (icon, name,
 * headline numbers) and its boundary in resources - what goes in, what comes
 * out - so a screenshot dropped in a chat answers the questions a plan link
 * would. Rendered as ordinary DOM at a design width, photographed with the
 * same pipeline as the board, then scaled to the board's width; on a huge
 * zoomed-out factory the bar therefore grows with the image instead of
 * shrinking into an unreadable strip.
 */

/**
 * Below this the bar's columns collide; above it, rows spread too thin. The
 * ceiling is deliberately low: the bar is scaled UP to the board's width, so
 * a small design width is what makes the lettering a large fraction of the
 * final image - the difference between readable and a hairline once Discord
 * fits a 3000px export into a chat column.
 */
export const EXPORT_FOOTER_MIN_WIDTH = 640;
export const EXPORT_FOOTER_MAX_WIDTH = 960;

export function resolveExportFooterWidth(boardWidth: number): number {
  if (!Number.isFinite(boardWidth) || boardWidth <= 0) {
    return EXPORT_FOOTER_MIN_WIDTH;
  }
  return Math.round(
    Math.min(EXPORT_FOOTER_MAX_WIDTH, Math.max(EXPORT_FOOTER_MIN_WIDTH, boardWidth)),
  );
}

export type ExportTone = "dark" | "light";

/**
 * Which face the bar wears, decided by the paper behind the board: a light
 * theme (Parchment, Paper) gets ink on cream, everything else - including a
 * transparent export, which lands who-knows-where but usually on Discord's
 * dark chat - gets the dark plate.
 */
export function resolveExportTone(background?: string): ExportTone {
  const hex = background?.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) {
    return "dark";
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.55 ? "light" : "dark";
}

interface FooterPalette {
  plate: string;
  edge: string;
  text: string;
  subtle: string;
  muted: string;
  brand: string;
  needs: string;
  needsPanel: string;
  needsEdge: string;
  makes: string;
  makesPanel: string;
  makesEdge: string;
}

const PALETTES: Record<ExportTone, FooterPalette> = {
  // Inputs red, outputs green - the same ink the side panel's sections and
  // the boundary drawers wear, so the bar speaks the board's own language.
  dark: {
    plate: "#131417",
    edge: "#2a2d33",
    text: "#e8e9ec",
    subtle: "#9aa1ab",
    muted: "#686f7a",
    brand: "#22d3ee",
    needs: "#f87171",
    needsPanel: "rgba(239,68,68,0.07)",
    needsEdge: "rgba(239,68,68,0.28)",
    makes: "#34d399",
    makesPanel: "rgba(52,211,153,0.07)",
    makesEdge: "rgba(52,211,153,0.28)",
  },
  light: {
    plate: "#e9e2cd",
    edge: "#c4b995",
    text: "#2c2a24",
    subtle: "#5f5947",
    muted: "#8a8370",
    brand: "#0e7490",
    needs: "#991b1b",
    needsPanel: "rgba(153,27,27,0.08)",
    needsEdge: "rgba(153,27,27,0.3)",
    makes: "#065f46",
    makesPanel: "rgba(6,95,70,0.08)",
    makesEdge: "rgba(6,95,70,0.3)",
  },
};

export interface ExportFooterProps {
  planName: string;
  icon?: EntryIcon;
  stats: CommunityPlanStats;
  tone: ExportTone;
  width: number;
  showTitle: boolean;
  /** The Inputs/Outputs panels; off leaves a nameplate-only bar. */
  showIo: boolean;
  /** Already curated: the dialog drops rows the player unchecked. */
  needs: PlanResourceStat[];
  outputs: PlanResourceStat[];
}

export function ExportFooter({
  planName,
  icon,
  stats,
  tone,
  width,
  showTitle,
  showIo,
  needs,
  outputs,
}: ExportFooterProps) {
  const palette = PALETTES[tone];

  return (
    <div
      style={{
        width,
        backgroundColor: palette.plate,
        borderTop: `2px solid ${palette.edge}`,
        color: palette.text,
      }}
      className="px-4 py-3"
    >
      {showTitle ? (
        // The name owns the whole top line: setups are christened things
        // like "Platline v4 (LV glass, no cleanroom)" and a side column
        // truncated them. It wraps rather than clips; the numbers keep to
        // the right.
        <div
          className={[
            "flex items-start justify-between gap-4",
            showIo ? "mb-2" : "",
          ].join(" ")}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {icon ? (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
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
                  className="!h-full !w-full"
                />
              </span>
            ) : null}
            <div className="min-w-0 break-words text-[18px] font-bold leading-6">{planName}</div>
          </div>
          <div className="shrink-0 pt-0.5 text-right">
            <div
              style={{ color: palette.subtle }}
              className="flex items-center justify-end gap-2 text-[13px] tabular-nums"
            >
              <span>{stats.machineCount} machines</span>
              <span aria-hidden>·</span>
              <span>{stats.nodeCount} cards</span>
              {stats.highestTier ? <TierBadge tier={stats.highestTier} /> : null}
            </div>
            <div className="mt-0.5 text-[12px]">
              <span style={{ color: palette.brand }} className="font-semibold">
                gtnhplanner.com
              </span>
            </div>
          </div>
        </div>
      ) : null}
      {/* "Inputs" and "Outputs", the same words the panel on the right of
          the app uses for the same numbers. */}
      {showIo ? (
        <div className="flex items-start gap-3">
        <IoColumn
          label="Inputs"
          accent={palette.needs}
          panel={palette.needsPanel}
          panelEdge={palette.needsEdge}
          palette={palette}
          stats={needs}
        />
        <IoColumn
          label="Outputs"
          accent={palette.makes}
          panel={palette.makesPanel}
          panelEdge={palette.makesEdge}
          palette={palette}
          stats={outputs}
        />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One side of the boundary as its own tinted panel: the wash of the
 * section's colour behind its rows is what lets a reader split needs from
 * makes at arm's length, before any label is legible.
 */
function IoColumn({
  label,
  accent,
  panel,
  panelEdge,
  palette,
  stats,
}: {
  label: string;
  accent: string;
  panel: string;
  panelEdge: string;
  palette: FooterPalette;
  stats: PlanResourceStat[];
}) {
  return (
    <div
      className="min-w-0 flex-1 rounded px-2.5 py-2"
      style={{ backgroundColor: panel, border: `1px solid ${panelEdge}` }}
    >
      <div style={{ color: accent }} className="text-[12px] font-bold uppercase tracking-[0.14em]">
        {label}
      </div>
      {stats.length === 0 ? (
        <div style={{ color: palette.muted }} className="mt-1.5 text-[13px]">
          Nothing
        </div>
      ) : (
        <div
          className="mt-1 grid gap-x-3"
          // A plan can have hundreds of boundary resources; the grid packs
          // them into as many columns as the panel affords and the bar
          // simply grows downward.
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
        >
          {stats.map((stat) => (
            <div
              key={`${stat.kind}:${stat.resourceId}`}
              className="flex items-center gap-1.5 py-px"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden">
                <ResourceIcon

                  itemZoom={1.5}
                  resource={{ ...stat, id: stat.resourceId, amount: 1 }}
                  bare
                  tooltip={false}
                  showAmount={false}
                  iconPixelSize={
                    stat.kind === "fluid"
                      ? isSwatchFluid(stat)
                        ? 40
                        : fluidArtPixels(24)
                      : undefined
                  }
                  className="!h-6 !w-6"
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {stat.displayName ?? stat.resourceId}
              </span>
              <span
                style={{ color: palette.subtle }}
                className="shrink-0 tabular-nums text-[14px]"
              >
                {formatSlotRate(stat.ratePerSecond, stat.kind)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
