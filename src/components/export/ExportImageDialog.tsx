"use client";

import { Check, Eye, EyeOff, ImageDown, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toBlob, toSvg } from "html-to-image";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { PlanResourceStat } from "@/lib/community/types";
import { serializeFactoryProject } from "@/lib/import-export";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  dataUrlToText,
  embedProjectJsonInPng,
  embedProjectJsonInSvg,
  type FlowExportCapture,
} from "@/lib/import-export/plan-image";
import { resolveExportFontCss } from "@/lib/import-export/export-fonts";
import {
  composeExportSvg,
  compositeExportPng,
  computeCompositeLayout,
  resolveExportBorderWidth,
  type ExportBorder,
} from "@/lib/import-export/export-composite";
import { randomUUID } from "@/lib/random-id";
import {
  CANVAS_THEMES,
  getCanvasTheme,
  type CanvasThemeId,
} from "@/components/flow/canvas-themes";
import { readBoardViewSnapshot } from "@/components/flow/board-view";
import type { RateUnit } from "@/lib/model/rate-unit";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { ExportFooter, resolveExportFooterWidth, resolveExportTone } from "./ExportFooter";
import { renderPlanGif } from "./gif-export";

type ExportFormat = "png" | "svg" | "gif";
type ExportBackground = CanvasThemeId | "transparent";
// The board's own looks, offered by name: the whole card, then the four
// smart views at their zoomed-out step.
type ExportCardDetail = "full" | "glance" | "status" | "usage" | "power";

const CARD_DETAILS: Array<{ id: ExportCardDetail; label: string }> = [
  { id: "full", label: "Detailed" },
  { id: "glance", label: "Big icons" },
  { id: "status", label: "Speed" },
  { id: "usage", label: "Usage" },
  { id: "power", label: "Power" },
];

interface CaptureResult {
  capture?: FlowExportCapture;
  error?: string;
}

const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "svg", label: "SVG" },
  { id: "gif", label: "GIF" },
];

const RATE_UNITS: Array<{ id: RateUnit; label: string }> = [
  { id: "tick", label: "/t" },
  { id: "second", label: "/s" },
  { id: "minute", label: "/min" },
  { id: "hour", label: "/hr" },
  { id: "eu", label: "EU/Item" },
];

/** The checkerboard every image editor uses for "nothing here". */
const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(#3a3d42 0% 25%, #26282d 0% 50%)",
  backgroundSize: "16px 16px",
};

/**
 * Export the board as a picture, dressed for sharing: a live preview, the
 * paper colour of your choice, and a summary bar that says what the plan
 * needs and makes so the image answers questions on its own. PNG and SVG
 * carry the plan itself; a GIF carries the motion.
 */
export function ExportImageDialog({ onClose }: { onClose: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const setScreenshotMode = useFactoryStore((state) => state.setScreenshotMode);
  const mode = project.poolMode ? "pool" : project.solveMode ? "solve" : "build";
  const activeTabName = useDesignStore(
    (state) =>
      state.designs.find((design) => design.id === state.activeDesignId)?.name ?? "Untitled",
  );
  // The rate unit is shared with the board (the /t /s /m /h buttons):
  // flipping it here changes the live numbers everywhere, and the preview
  // photographs them again.
  const rateUnit = useFactoryStore((state) => state.rateUnit);
  const setRateUnit = useFactoryStore((state) => state.setRateUnit);

  const [format, setFormat] = useState<ExportFormat>("png");
  const [background, setBackground] = useState<ExportBackground>(
    () => readBoardViewSnapshot().canvasTheme,
  );
  const [cardDetail, setCardDetail] = useState<ExportCardDetail>("full");
  const [includeFooter, setIncludeFooter] = useState(true);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeIo, setIncludeIo] = useState(true);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [capture, setCapture] = useState<FlowExportCapture>();
  const [isCapturing, setCapturing] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  // Uncapped: a base with two hundred boundary resources prints them all
  // unless its owner unchecks some.
  const stats = useMemo(
    () => computeCommunityPlanStats(project, result, Number.POSITIVE_INFINITY),
    [project, result],
  );
  const backgroundColor =
    background === "transparent" ? undefined : getCanvasTheme(background).base;
  const tone = resolveExportTone(backgroundColor);
  // The frame is always on and always the paper's own accent: the ink the
  // theme draws its dots in. Not a knob - one less decision, and it cannot
  // clash.
  const borderColor =
    background === "transparent" ? "#454a52" : getCanvasTheme(background).patternColor;
  const planName = project.name || activeTabName || "My factory";

  const needs = useMemo(
    () => stats.needs.filter((stat) => !excluded.has(statKey(stat))),
    [stats.needs, excluded],
  );
  const outputs = useMemo(
    () => stats.outputs.filter((stat) => !excluded.has(statKey(stat))),
    [stats.outputs, excluded],
  );

  // ---- Asking the board for its photograph ------------------------------

  const pendingRef = useRef(new Map<string, (result: CaptureResult) => void>());
  useEffect(() => {
    const handleComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { requestId?: unknown; capture?: FlowExportCapture; error?: unknown }
        | undefined;
      if (typeof detail?.requestId !== "string") {
        return;
      }
      const resolve = pendingRef.current.get(detail.requestId);
      if (resolve) {
        pendingRef.current.delete(detail.requestId);
        resolve({
          capture: detail.capture,
          error: typeof detail.error === "string" ? detail.error : undefined,
        });
      }
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
    return () => window.removeEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
  }, []);

  const requestBoardCapture = useCallback(
    (captureFormat: "png" | "svg") =>
      new Promise<CaptureResult>((resolve) => {
        const requestId = randomUUID();
        pendingRef.current.set(requestId, resolve);
        window.dispatchEvent(
          new CustomEvent(FLOW_IMAGE_EXPORT_EVENT, {
            detail: {
              format: captureFormat,
              requestId,
              capture: true,
              background: background === "transparent" ? "transparent" : backgroundColor,
              cardDetail,
              hideAnnotations: !includeAnnotations,
            },
          }),
        );
        // A board that never answers (no viewport mounted) must not hang the
        // dialog on a spinner forever.
        window.setTimeout(() => {
          if (pendingRef.current.delete(requestId)) {
            resolve({ error: "Timed out photographing the board." });
          }
        }, 120_000);
      }),
    [background, backgroundColor, cardDetail, includeAnnotations],
  );

  // Recapture when the mode, card look, paper or rates change. The summary
  // bar and its visibility controls compose on top of the existing image.
  useEffect(() => {
    let cancelled = false;
    setCapturing(true);
    setError(undefined);
    const attempt = (retriesLeft: number) => {
      void requestBoardCapture("png").then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.capture?.blob) {
          if (retriesLeft > 0) {
            window.setTimeout(() => {
              if (!cancelled) {
                attempt(retriesLeft - 1);
              }
            }, 700);
            return;
          }
          setCapturing(false);
          setError(
            result.error ?? "The board could not be captured. Close the dialog and try again.",
          );
          return;
        }
        setCapture(result.capture);
        setCapturing(false);
      });
    };
    // Let the mode switch mount its worksheet/canvas and publish its capture listener.
    const frame = requestAnimationFrame(() => attempt(2));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // rateUnit repaints the BOARD, not the request: the photograph must be
    // retaken to show the new numbers.
  }, [requestBoardCapture, rateUnit, mode]);

  const previewUrl = useMemo(
    () => (capture?.blob ? URL.createObjectURL(capture.blob) : undefined),
    [capture],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // ---- Measuring the pieces the composite needs -------------------------

  const [previewBox, setPreviewBox] = useState({ width: 0, height: 0 });
  const previewShellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => setPreviewBox({ width: shell.clientWidth, height: shell.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    measure();
    return () => observer.disconnect();
  }, []);

  const [footerElement, setFooterElement] = useState<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  useEffect(() => {
    if (!footerElement || typeof ResizeObserver === "undefined") {
      setFooterHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => setFooterHeight(footerElement.offsetHeight));
    observer.observe(footerElement);
    setFooterHeight(footerElement.offsetHeight);
    return () => observer.disconnect();
  }, [footerElement]);

  const footerVisible =
    includeFooter &&
    (includeTitle || (includeIo && (needs.length > 0 || outputs.length > 0)));
  const footerWidth = capture ? resolveExportFooterWidth(capture.width) : 0;
  const layout = useMemo(
    () =>
      capture
        ? computeCompositeLayout(
            capture.width,
            capture.height,
            footerVisible ? footerWidth : 0,
            footerVisible ? footerHeight : 0,
          )
        : undefined,
    [capture, footerVisible, footerWidth, footerHeight],
  );
  // Contain-fit: the WHOLE image - board, bar, frame - inside the preview
  // box, letterboxed as needed. A tall narrow plan shrinks to fit rather
  // than asking anyone to scroll to find out what their export looks like.
  const previewScale =
    capture && layout && previewBox.width > 0 && previewBox.height > 0
      ? Math.min(previewBox.width / capture.width, previewBox.height / layout.totalHeight)
      : 0;
  const exportBorder: ExportBorder | undefined =
    borderColor && capture
      ? { color: borderColor, width: resolveExportBorderWidth(capture.width) }
      : undefined;

  // ---- The export itself ------------------------------------------------

  const exportNow = async () => {
    if (!capture || !layout || busy) {
      return;
    }
    setError(undefined);
    setSaved(false);
    try {
      const fileName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory";
      const projectJson = serializeFactoryProject(project);
      const wantFooter = footerVisible && footerElement !== null && layout.footerHeight > 0;
      const fontEmbedCSS =
        wantFooter && footerElement ? await resolveExportFontCss(footerElement) : undefined;

      if (format === "svg") {
        setBusy("Rendering the SVG");
        const svgResult = await requestBoardCapture("svg");
        const svgCapture = svgResult.capture;
        if (!svgCapture?.svgText) {
          throw new Error(svgResult.error ?? "The board could not be rendered as SVG.");
        }
        const footerSvg =
          wantFooter && footerElement
            ? dataUrlToText(
                await toSvg(footerElement, {
                  width: layout.footerWidth,
                  height: layout.footerHeight,
                  skipFonts: true,
                  fontEmbedCSS,
                }),
              )
            : undefined;
        const composed = composeExportSvg({
          boardSvg: svgCapture.svgText,
          footerSvg,
          layout,
          background: backgroundColor,
          border: exportBorder,
        });
        downloadBlob(
          new Blob([embedProjectJsonInSvg(composed, projectJson)], { type: "image/svg+xml" }),
          `${fileName}.svg`,
        );
      } else {
        if (!capture.blob) {
          throw new Error("The board capture is missing.");
        }
        setBusy("Composing the image");
        const footerBlob =
          wantFooter && footerElement
            ? ((await toBlob(footerElement, {
                width: layout.footerWidth,
                height: layout.footerHeight,
                pixelRatio: layout.footerScale * capture.pixelRatio,
                skipFonts: true,
                fontEmbedCSS,
              })) ?? undefined)
            : undefined;

        if (format === "png") {
          const composed = await compositeExportPng({
            boardBlob: capture.blob,
            footerBlob,
            layout,
            pixelRatio: capture.pixelRatio,
            background: backgroundColor,
            border: exportBorder,
          });
          setBusy("Embedding the plan");
          const withPlan = await embedProjectJsonInPng(composed, projectJson, backgroundColor);
          downloadBlob(withPlan, `${fileName}.png`);
        } else {
          const gifBlob = await renderPlanGif({
            boardBlob: capture.blob,
            footerBlob,
            layout,
            capture,
            background: backgroundColor,
            border: exportBorder,
            onProgress: (frame, total) => setBusy(`Drawing frame ${frame} of ${total}`),
          });
          downloadBlob(gifBlob, `${fileName}.gif`);
        }
      }

      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Screenshot editor" className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4">
      <div className="flex max-h-[calc(94*var(--ui-vh))] w-full max-w-5xl flex-col overflow-y-auto rounded border border-line-strong bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ImageDown className="h-4 w-4" /> Export an image
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview: the real capture over the real bar, the WHOLE image
            contain-fit in a fixed window - never a scrollbar between a
            player and what their export looks like. */}
        <div
          ref={previewShellRef}
          className="relative grid h-[calc(52*var(--ui-vh))] place-items-center overflow-hidden rounded border border-line bg-surface-sunken"
        >
          <div>
            {previewUrl && capture && previewScale > 0 ? (
              <div
                className="pointer-events-none relative select-none"
                style={{
                  width: capture.width * previewScale,
                  ...(background === "transparent" ? CHECKER_STYLE : {}),
                }}
              >
                <img src={previewUrl} alt="Board export preview" className="block w-full" />
                {footerVisible && layout && previewScale > 0 ? (
                  <div
                    style={{
                      height: layout.footerHeight * layout.footerScale * previewScale,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: layout.footerWidth,
                        transform: `scale(${layout.footerScale * previewScale})`,
                        transformOrigin: "top left",
                      }}
                    >
                      <div ref={setFooterElement}>
                        <ExportFooter
                          planName={planName}
                          icon={project.icon}
                          stats={stats}
                          tone={tone}
                          width={layout.footerWidth}
                          showTitle={includeTitle}
                          showIo={includeIo}
                          needs={needs}
                          outputs={outputs}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {exportBorder ? (
                  <div
                    className="absolute inset-0"
                    style={{
                      boxShadow: `inset 0 0 0 ${Math.max(
                        1,
                        exportBorder.width * previewScale,
                      )}px ${exportBorder.color}`,
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          {isCapturing ? (
            <div className="absolute inset-0 grid place-items-center bg-neutral-950/40">
              <span className="flex items-center gap-2 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-subtle">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Photographing the board
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-subtle">Mode</span>
              <div role="group" aria-label="Screenshot mode" className="flex overflow-hidden rounded border border-line-strong">
                {(["build", "solve", "pool"] as const).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    disabled={isCapturing || Boolean(busy)}
                    onClick={() => {
                      if (entry === mode) return;
                      setCapturing(true);
                      setScreenshotMode(entry);
                    }}
                    aria-pressed={mode === entry}
                    className={[
                      "px-2.5 py-1 text-xs capitalize disabled:opacity-50",
                      mode === entry ? "bg-cyan-600 font-medium text-white" : "bg-surface text-fg-subtle hover:bg-surface-raised",
                    ].join(" ")}
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-subtle">Type</span>
              <div className="flex overflow-hidden rounded border border-line-strong">
                {FORMATS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFormat(entry.id)}
                    aria-pressed={format === entry.id}
                    className={
                      format === entry.id
                        ? "bg-cyan-600 px-3 py-1 text-xs font-medium text-white"
                        : "bg-surface px-3 py-1 text-xs text-fg-subtle hover:bg-surface-raised"
                    }
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={mode === "pool" ? "hidden" : "flex items-center gap-2"}>
              <span className="text-xs font-medium text-fg-subtle">Cards</span>
              <div className="flex overflow-hidden rounded border border-line-strong">
                {CARD_DETAILS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setCardDetail(entry.id)}
                    aria-pressed={cardDetail === entry.id}
                    className={
                      cardDetail === entry.id
                        ? "bg-cyan-600 px-3 py-1 text-xs font-medium text-white"
                        : "bg-surface px-3 py-1 text-xs text-fg-subtle hover:bg-surface-raised"
                    }
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-subtle">Rates</span>
              <div className="flex overflow-hidden rounded border border-line-strong">
                {RATE_UNITS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setRateUnit(entry.id)}
                    aria-pressed={rateUnit === entry.id}
                    className={
                      rateUnit === entry.id
                        ? "bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white"
                        : "bg-surface px-2.5 py-1 text-xs text-fg-subtle hover:bg-surface-raised"
                    }
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-fg-subtle">Paper</span>
            {CANVAS_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                title={theme.name}
                aria-label={`${theme.name} background`}
                aria-pressed={background === theme.id}
                onClick={() => setBackground(theme.id)}
                className={[
                  "h-6 w-6 rounded border",
                  background === theme.id
                    ? "border-cyan-500 ring-1 ring-cyan-500"
                    : "border-line-strong hover:border-fg-muted",
                ].join(" ")}
                style={{ backgroundColor: theme.base }}
              />
            ))}
            <button
              type="button"
              title="Transparent"
              aria-label="Transparent background"
              aria-pressed={background === "transparent"}
              onClick={() => setBackground("transparent")}
              className={[
                "h-6 w-6 rounded border",
                background === "transparent"
                  ? "border-cyan-500 ring-1 ring-cyan-500"
                  : "border-line-strong hover:border-fg-muted",
              ].join(" ")}
              style={CHECKER_STYLE}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeFooter}
                onChange={(event) => setIncludeFooter(event.target.checked)}
              />
              Summary bar
            </label>
            <label
              className={includeFooter ? "flex items-center gap-1.5" : "hidden"}
            >
              <input
                type="checkbox"
                checked={includeTitle}
                onChange={(event) => setIncludeTitle(event.target.checked)}
              />
              Title and stats
            </label>
            <label
              className={includeFooter ? "flex items-center gap-1.5" : "hidden"}
            >
              <input
                type="checkbox"
                checked={includeIo}
                onChange={(event) => setIncludeIo(event.target.checked)}
              />
              Inputs and outputs
            </label>
            <label className={mode === "pool" ? "hidden" : "flex items-center gap-1.5"}>
              <input
                type="checkbox"
                checked={includeAnnotations}
                onChange={(event) => setIncludeAnnotations(event.target.checked)}
              />
              Annotations
            </label>
          </div>

          {includeFooter && includeIo ? (
            <div className="space-y-2">
              <ResourceChipRow
                label="Inputs"
                stats={stats.needs}
                excluded={excluded}
                onToggle={(key) => setExcluded((current) => toggleKey(current, key))}
              />
              <ResourceChipRow
                label="Outputs"
                stats={stats.outputs}
                excluded={excluded}
                onToggle={(key) => setExcluded((current) => toggleKey(current, key))}
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            {busy ? (
              <span className="mr-auto flex items-center gap-2 text-xs text-fg-muted">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {busy}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void exportNow()}
              disabled={!capture || Boolean(busy) || isCapturing}
              className="inline-flex items-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : null}
              {saved ? "Saved" : `Save ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function statKey(stat: PlanResourceStat): string {
  return `${stat.kind}:${stat.resourceId}`;
}

function toggleKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * The curation row: every boundary resource as a chip, lit when it will be
 * on the bar. Unchecking noise (that one stray dust) is the whole feature,
 * so each chip wears an eye - the universal "this is a visibility toggle" -
 * rather than relying on anyone guessing that a chip is clickable. Plans
 * with hundreds of boundary resources scroll inside the row.
 */
function ResourceChipRow({
  label,
  stats,
  excluded,
  onToggle,
}: {
  label: string;
  stats: PlanResourceStat[];
  excluded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (stats.length === 0) {
    return null;
  }
  return (
    <div className="flex items-start gap-2">
      <span className="w-14 shrink-0 pt-1 text-xs font-medium text-fg-subtle">{label}</span>
      <div className="flex max-h-24 min-w-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto">
        {stats.map((stat) => {
          const key = statKey(stat);
          const isExcluded = excluded.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={!isExcluded}
              title={isExcluded ? "Show on the summary bar" : "Hide from the summary bar"}
              className={[
                "inline-flex max-w-48 items-center gap-1 rounded border px-1.5 py-0.5 text-xs",
                isExcluded
                  ? "border-line bg-surface-sunken text-fg-muted"
                  : "border-line-strong bg-surface text-fg-subtle hover:border-cyan-600",
              ].join(" ")}
            >
              {isExcluded ? (
                <EyeOff className="h-3 w-3 shrink-0" />
              ) : (
                <Eye className="h-3 w-3 shrink-0 text-cyan-500" />
              )}
              <span className={isExcluded ? "truncate line-through" : "truncate"}>
                {stat.displayName ?? stat.resourceId}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
