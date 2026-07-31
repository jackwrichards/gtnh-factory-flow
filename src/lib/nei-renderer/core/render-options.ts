export type NeiRenderPreset = "native" | "readable" | "compact" | "flow-node" | "debug";

export interface NeiRenderOptions {
  preset: NeiRenderPreset;
  scale: number;
  showChrome: boolean;
  showHeader: boolean;
  showPageBar: boolean;
  showOverlayButtons: boolean;
  showEmptySlots: boolean;
  showStats: boolean;
  showDebugBounds: boolean;
  slotSize: number;
  iconSize: number;
  aspectSize: number;
  textMode: "minecraft" | "readable";
  fluidDisplay: "slot" | "large" | "text";
  aspectDisplay: "slot" | "large" | "text" | "badge";
}

const BASE_OPTIONS: NeiRenderOptions = {
  preset: "native",
  scale: 2,
  showChrome: true,
  showHeader: true,
  showPageBar: true,
  showOverlayButtons: true,
  showEmptySlots: true,
  showStats: true,
  showDebugBounds: false,
  slotSize: 18,
  iconSize: 36,
  aspectSize: 18,
  textMode: "minecraft",
  fluidDisplay: "slot",
  aspectDisplay: "slot",
};

const PRESETS: Record<NeiRenderPreset, Partial<NeiRenderOptions>> = {
  native: {},
  readable: {
    showChrome: false,
    showHeader: false,
    showPageBar: false,
    showOverlayButtons: false,
    showEmptySlots: true,
    showStats: true,
    textMode: "readable",
    fluidDisplay: "large",
    aspectDisplay: "badge",
  },
  compact: {
    showHeader: false,
    showPageBar: false,
    showOverlayButtons: false,
    showStats: false,
    slotSize: 18,
    iconSize: 36,
  },
  "flow-node": {
    showChrome: false,
    showHeader: false,
    showPageBar: false,
    showOverlayButtons: false,
    showStats: false,
    showEmptySlots: true,
    textMode: "readable",
  },
  debug: {
    showDebugBounds: true,
    showStats: true,
    textMode: "readable",
  },
};

export function resolveNeiRenderOptions(partial: Partial<NeiRenderOptions> = {}): NeiRenderOptions {
  const preset = partial.preset ?? BASE_OPTIONS.preset;
  return {
    ...BASE_OPTIONS,
    ...PRESETS[preset],
    ...partial,
    preset,
  };
}
