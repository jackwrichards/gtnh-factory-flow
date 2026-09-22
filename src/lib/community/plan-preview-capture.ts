"use client";

import { getCanvasTheme } from "@/components/flow/canvas-themes";
import { readBoardViewSnapshot } from "@/components/flow/board-view";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  type FlowExportCapture,
} from "@/lib/import-export/plan-image";
import { BOARD_IMAGE_MAX_BYTES } from "@/lib/community/types";
import { randomUUID } from "@/lib/random-id";

/**
 * The photograph a shared link unfurls into: the live board, taken with the
 * export dialog's defaults (detailed cards, ordinary board colours, no
 * margin notes, the author's own paper). Captured at the moment of sharing —
 * the same moment the plan JSON goes out — so the picture and the post can
 * never disagree.
 *
 * Best-effort by design: a plan must still share on a browser that cannot
 * photograph it, so every failure path resolves to undefined, never a throw.
 */

/** Pixel bounds for the uploaded preview: plenty for a 1200x630 embed. */
const PREVIEW_MAX_WIDTH = 1600;
const PREVIEW_MAX_HEIGHT = 1000;
const CAPTURE_TIMEOUT_MS = 45_000;

export async function capturePlanPreviewPng(): Promise<Blob | undefined> {
  try {
    const capture = await requestBoardPhotograph();
    if (!capture?.blob) {
      return undefined;
    }
    const scaled = await boundPreviewSize(capture.blob);
    return scaled && scaled.size <= BOARD_IMAGE_MAX_BYTES ? scaled : undefined;
  } catch {
    return undefined;
  }
}

function requestBoardPhotograph(): Promise<FlowExportCapture | undefined> {
  return new Promise((resolve) => {
    const requestId = randomUUID();

    const handleComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { requestId?: unknown; capture?: FlowExportCapture }
        | undefined;
      if (detail?.requestId !== requestId) {
        return;
      }
      window.removeEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
      window.clearTimeout(timeout);
      resolve(detail.capture);
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
    // A board that never answers (no viewport mounted) must not hang sharing.
    // Set before the dispatch below, so the complete handler can clear it no
    // matter how quickly the board replies.
    const timeout = window.setTimeout(() => {
      window.removeEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
      resolve(undefined);
    }, CAPTURE_TIMEOUT_MS);

    window.dispatchEvent(
      new CustomEvent(FLOW_IMAGE_EXPORT_EVENT, {
        detail: {
          format: "png",
          requestId,
          capture: true,
          background: getCanvasTheme(readBoardViewSnapshot().canvasTheme).base,
          cardDetail: "full",
          hideAnnotations: true,
        },
      }),
    );
  });
}

/**
 * The raw capture is the whole board at device pixel ratio — a big plan can
 * be tens of megapixels. The embed shows it at most ~1100px wide, so shrink
 * to a bounded canvas before uploading; small boards pass through untouched.
 */
async function boundPreviewSize(blob: Blob): Promise<Blob | undefined> {
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(
      1,
      PREVIEW_MAX_WIDTH / image.width,
      PREVIEW_MAX_HEIGHT / image.height,
    );
    if (scale === 1) {
      return blob;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      return blob;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((scaled) => resolve(scaled ?? undefined), "image/png");
    });
  } finally {
    image.close();
  }
}
