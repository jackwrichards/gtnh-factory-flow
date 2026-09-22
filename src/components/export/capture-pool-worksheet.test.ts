// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePoolWorksheet, worksheetCaptureSize } from "./capture-pool-worksheet";

const render = vi.hoisted(() => ({ toBlob: vi.fn(), toSvg: vi.fn() }));
vi.mock("html-to-image", () => render);
vi.mock("@/lib/import-export/export-fonts", () => ({ resolveExportFontCss: async () => "" }));

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("worksheet captures", () => {
  it("keeps a tall sheet whole while bounding raster dimensions", () => {
    const size = worksheetCaptureSize(1200, 24000);
    expect(size.height).toBe(8192);
    expect(size.width).toBe(410);
    expect(size.pixelRatio).toBe(1);
    expect(worksheetCaptureSize(1200, 900)).toEqual({
      width: 1200,
      height: 900,
      scale: 1,
      pixelRatio: 2,
    });
  });

  it.each([false, true])(
    "restores expanded scrollers and sticky headings after capture (failure: %s)",
    async (failure) => {
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      const sheet = document.createElement("section");
      sheet.style.cssText = "position:absolute;height:600px";
      sheet.innerHTML =
        '<div class="pool-sheet-scroll" style="overflow:auto;height:500px"><div style="position:sticky;top:0">Heading</div><div class="pool-products-scroll" style="overflow:auto;max-height:150px">Last desired rate</div></div>';
      document.body.append(sheet);
      const scroller = sheet.firstElementChild as HTMLElement;
      const heading = scroller.firstElementChild as HTMLElement;
      const nested = scroller.lastElementChild as HTMLElement;
      const saved = [sheet, scroller, heading, nested].map((element) =>
        element.getAttribute("style"),
      );
      scroller.scrollTop = 340;
      nested.scrollTop = 80;
      Object.defineProperties(sheet, {
        offsetWidth: { value: 1200 },
        scrollWidth: { value: 1200 },
        scrollHeight: { value: 4000 },
      });
      render.toBlob.mockImplementationOnce(async (_element, options) => {
        expect(options.height).toBe(4000);
        expect(scroller.style.overflow).toBe("visible");
        expect(nested.style.maxHeight).toBe("none");
        expect(heading.style.position).toBe("static");
        expect(scroller.scrollTop).toBe(0);
        if (failure) throw new Error("render failed");
        return new Blob(["image"], { type: "image/png" });
      });
      const capture = capturePoolWorksheet(sheet, {
        format: "png",
        requestId: "test",
        capture: true,
      });
      if (failure) await expect(capture).rejects.toThrow("render failed");
      else expect((await capture).height).toBe(4000);
      expect(
        [sheet, scroller, heading, nested].map((element) => element.getAttribute("style")),
      ).toEqual(saved);
      expect(scroller.scrollTop).toBe(340);
      expect(nested.scrollTop).toBe(80);
      vi.unstubAllGlobals();
    },
  );
});
