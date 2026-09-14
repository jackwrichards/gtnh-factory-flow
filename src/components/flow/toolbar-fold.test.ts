import { describe, expect, it } from "vitest";
import { toolbarFoldFor } from "./toolbar-fold";

describe("toolbarFoldFor", () => {
  it("steps from labels to icons before folding the build tools", () => {
    expect(toolbarFoldFor(950, false)).toMatchObject({ build: false, paint: false, modeIconsOnly: false });
    expect(toolbarFoldFor(800, false)).toMatchObject({ build: false, paint: false, modeIconsOnly: true });
    expect(toolbarFoldFor(700, false)).toMatchObject({ build: true, paint: false, modeIconsOnly: true });
  });

  it("fits Firefox's larger text without folding while the icons still fit", () => {
    expect(toolbarFoldFor(1150, false, 1.5)).toMatchObject({ build: false, modeIconsOnly: false });
    expect(toolbarFoldFor(1050, false, 1.5)).toMatchObject({ build: false, modeIconsOnly: true });
    expect(toolbarFoldFor(950, false, 1.5)).toMatchObject({ build: true, modeIconsOnly: true });
  });

  it("keeps the right tools visible until the folded left tools crowd them", () => {
    expect(toolbarFoldFor(700, false)).toMatchObject({ build: true, paint: false });
    expect(toolbarFoldFor(200, false)).toMatchObject({ build: true, paint: true });
  });

  it("folds both on a compact viewport", () => {
    expect(toolbarFoldFor(2000, true)).toEqual({ build: true, paint: true, paintFoldsAll: true, modeIconsOnly: true });
  });

  it("does not let an invalid text size corrupt the layout", () => {
    expect(toolbarFoldFor(800, false, NaN)).toEqual(toolbarFoldFor(800, false));
  });
});
