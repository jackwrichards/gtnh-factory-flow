"use client";

import { toBlob, toSvg } from "html-to-image";
import { resolveExportFontCss } from "@/lib/import-export/export-fonts";
import {
  dataUrlToText,
  type FlowExportCapture,
  type FlowExportRequest,
} from "@/lib/import-export/plan-image";

const MAX_PIXEL_SIDE = 8192;

/** Bound the raster surface while keeping the entire worksheet in frame. */
export function worksheetCaptureSize(width: number, height: number) {
  const scale = Math.min(1, MAX_PIXEL_SIDE / Math.max(width, height));
  const imageWidth = Math.max(1, Math.ceil(width * scale));
  const imageHeight = Math.max(1, Math.ceil(height * scale));
  return {
    width: imageWidth,
    height: imageHeight,
    scale,
    pixelRatio: Math.min(2, MAX_PIXEL_SIDE / Math.max(imageWidth, imageHeight)),
  };
}

/** Expand scroll areas only for the photograph, then restore the exact live view. */
export async function capturePoolWorksheet(
  worksheet: HTMLElement,
  request: FlowExportRequest,
): Promise<FlowExportCapture> {
  const elements = [worksheet, ...worksheet.querySelectorAll<HTMLElement>("*")];
  const scrolls = elements
    .filter((element) => element.scrollTop || element.scrollLeft)
    .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  const styles = new Map<HTMLElement, string | null>();
  const change = (element: HTMLElement, properties: Partial<CSSStyleDeclaration>) => {
    if (!styles.has(element)) styles.set(element, element.getAttribute("style"));
    Object.assign(element.style, properties);
  };
  const width = worksheet.offsetWidth;
  const worksheetSurface = getComputedStyle(worksheet).backgroundColor;
  const background =
    request.background === "transparent" ? undefined : (request.background ?? worksheetSurface);
  try {
    // The modal covers this temporary expansion. Keeping the real DOM retains
    // loaded icons, responsive column widths, fonts and the user's group folds.
    change(worksheet, {
      inset: "auto",
      position: "relative",
      width: `${width}px`,
      height: "auto",
      maxHeight: "none",
      minHeight: "0",
      padding: "12px",
      overflow: "visible",
      backgroundColor: background ?? "transparent",
    });
    for (const element of elements.slice(1)) {
      const computed = getComputedStyle(element);
      // Like canvas cards, the worksheet keeps its readable surface even on light paper.
      if (element.matches(".pool-sheet-scroll"))
        change(element, { backgroundColor: worksheetSurface });
      if (
        /(auto|scroll)/.test(`${computed.overflow} ${computed.overflowX} ${computed.overflowY}`) ||
        element.matches(".pool-sheet-scroll, .pool-sheet-products, .pool-sheet-balance")
      ) {
        change(element, {
          overflow: "visible",
          height: "auto",
          maxHeight: "none",
          flex: "none",
          scrollbarGutter: "auto",
        });
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
      if (computed.position === "sticky") change(element, { position: "static" });
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    // scrollWidth includes any genuinely wide tables; scrollHeight includes
    // the worksheet's 130% inner zoom and every formerly scrollable row.
    const sourceWidth = Math.max(width, worksheet.scrollWidth);
    const sourceHeight = Math.max(worksheet.offsetHeight, worksheet.scrollHeight);
    const size = worksheetCaptureSize(sourceWidth, sourceHeight);
    const options = {
      width: size.width,
      height: size.height,
      backgroundColor: background,
      pixelRatio: size.pixelRatio,
      style: {
        width: `${sourceWidth}px`,
        height: `${sourceHeight}px`,
        margin: "0",
        zoom: "1",
        transform: `scale(${size.scale})`,
        transformOrigin: "top left",
      },
      skipFonts: true,
      fontEmbedCSS: await resolveExportFontCss(worksheet),
    };
    const capture: FlowExportCapture = {
      kind: request.format,
      width: size.width,
      height: size.height,
      pixelRatio: size.pixelRatio,
      background,
      viewport: { x: 0, y: 0, zoom: size.scale },
      occlusionRects: [],
      occlusionDots: [],
      pulses: [],
    };
    if (request.format === "svg") {
      capture.svgText = dataUrlToText(await toSvg(worksheet, options));
    } else {
      capture.blob = (await toBlob(worksheet, options)) ?? undefined;
      if (!capture.blob) throw new Error("The worksheet render came back empty.");
    }
    return capture;
  } finally {
    for (const [element, style] of styles) {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }
    for (const { element, top, left } of scrolls) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }
}
