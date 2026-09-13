import type { FactoryNodeColorTag } from "@/lib/model/types";

/**
 * Perceived brightness of a hex colour, 0 (black) to 1 (white) — the sRGB
 * relative luminance from WCAG, not a naive channel average, because green
 * reads far brighter than blue at the same numeric value.
 */
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The ink a tinted node has to switch to. Black text on the black tag and
 * white text on the white tag were both unreadable — the paint decides the
 * ink, so every swatch stays legible. The threshold sits where white and
 * black text reach equal contrast against the panel.
 */
export function inkFor(panel: string): { ink: string; inkMuted: string } {
  return relativeLuminance(panel) < 0.34
    ? { ink: "#f2f3f7", inkMuted: "rgba(242,243,247,0.74)" }
    : { ink: "#16161a", inkMuted: "rgba(22,22,26,0.66)" };
}

/** Small numbers on wire arrows use whichever ink has the greater contrast. */
export function arrowInkFor(fill: string): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(fill);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

export const GT_NODE_COLORS: Record<
  FactoryNodeColorTag,
  { swatch: string; panel: string; header: string; border: string; shadow: string }
> = {
  white: {
    swatch: "#f0f0f0",
    panel: "#d8d8d8",
    header: "#c8c8c8",
    border: "#9f9f9f",
    shadow: "#f0f0f0",
  },
  orange: {
    swatch: "#f9801d",
    panel: "#d4945d",
    header: "#c96b1e",
    border: "#914811",
    shadow: "#f9801d",
  },
  magenta: {
    swatch: "#c74ebd",
    panel: "#b983b4",
    header: "#a8439f",
    border: "#7d2c76",
    shadow: "#c74ebd",
  },
  light_blue: {
    swatch: "#3ab3da",
    panel: "#9eb6ce",
    header: "#7f99b8",
    border: "#637999",
    shadow: "#9eb6ce",
  },
  yellow: {
    swatch: "#fed83d",
    panel: "#d2bd68",
    header: "#c8a929",
    border: "#957912",
    shadow: "#fed83d",
  },
  lime: {
    swatch: "#80c71f",
    panel: "#9db76e",
    header: "#68a31c",
    border: "#487612",
    shadow: "#80c71f",
  },
  pink: {
    swatch: "#f38baa",
    panel: "#d0a0b0",
    header: "#c66f89",
    border: "#955168",
    shadow: "#f38baa",
  },
  gray: {
    swatch: "#474f52",
    panel: "#6b6f70",
    header: "#565e61",
    border: "#33383a",
    shadow: "#474f52",
  },
  light_gray: {
    swatch: "#9d9d97",
    panel: "#a6a6a0",
    header: "#85857f",
    border: "#62625e",
    shadow: "#9d9d97",
  },
  cyan: {
    swatch: "#169c9c",
    panel: "#73a6a6",
    header: "#168282",
    border: "#0e6262",
    shadow: "#169c9c",
  },
  purple: {
    swatch: "#8932b8",
    panel: "#9275a7",
    header: "#74309a",
    border: "#562172",
    shadow: "#8932b8",
  },
  blue: {
    swatch: "#3c44aa",
    panel: "#8f9ab8",
    header: "#6f7ea6",
    border: "#586484",
    shadow: "#3c44aa",
  },
  brown: {
    swatch: "#835432",
    panel: "#8b735f",
    header: "#70482d",
    border: "#50331f",
    shadow: "#835432",
  },
  green: {
    swatch: "#5e7c16",
    panel: "#788767",
    header: "#536c16",
    border: "#394b0d",
    shadow: "#5e7c16",
  },
  red: {
    swatch: "#b02e26",
    panel: "#a87572",
    header: "#962a24",
    border: "#6f1c18",
    shadow: "#b02e26",
  },
  black: {
    swatch: "#1d1d21",
    panel: "#555559",
    header: "#303033",
    border: "#111114",
    shadow: "#1d1d21",
  },
  // The system swatches: the app's own ink offered as paint, so a note or a
  // box can speak the same language the board already does. Scarlet is the
  // alarm/source red, amber the warning, emerald the output/byproduct green,
  // azure the product blue, steel the card face (--mc-78) and onyx the panel
  // surface. Derived with the red dye's own panel/header/border transforms so
  // they sit in the palette as equals, not stickers.
  scarlet: {
    swatch: "#ef4444",
    panel: "#d0a5a5",
    header: "#e82d2d",
    border: "#d01212",
    shadow: "#ef4444",
  },
  amber: {
    swatch: "#e0a63a",
    panel: "#c4b598",
    header: "#d59827",
    border: "#ad7a1b",
    shadow: "#e0a63a",
  },
  emerald: {
    swatch: "#10b981",
    panel: "#5fac93",
    header: "#11996c",
    border: "#0a6e4d",
    shadow: "#10b981",
  },
  azure: {
    swatch: "#3b82f6",
    panel: "#a2b4d1",
    header: "#2371ef",
    border: "#0a57d6",
    shadow: "#3b82f6",
  },
  steel: {
    swatch: "#3c3e45",
    panel: "#5f6064",
    header: "#2e2f34",
    border: "#161719",
    shadow: "#3c3e45",
  },
  onyx: {
    swatch: "#303238",
    panel: "#535458",
    header: "#222327",
    border: "#0c0c0e",
    shadow: "#303238",
  },
};

/*
 * There is deliberately no per-tag ink table any more. A card's ramp below
 * keeps an unpainted card's LIGHTNESSES, so the one light ink reads at the
 * same contrast on every colour and no card has to switch to dark text.
 */

/**
 * A painted card's own --mc-* ramp, one preset per colour tag.
 *
 * A card is built entirely out of the --mc-* tokens: the face is --mc-78, an
 * inset panel is --mc-71, a name bar --mc-61, a dropdown or a typed field
 * --mc-85, a head button --mc-49, the bevels --mc-100 and --mc-33. Painting a
 * card REDEFINES those tokens on the card itself, so every surface inside it
 * takes the colour without knowing it was painted - the port chips, the
 * plugs, the stat tiles, the config dials, the dropdowns and the little block
 * beside them, the machine tabs, the close and copy buttons. There is no list
 * of elements to keep in sync, which is the whole reason for doing it this
 * way: every previous attempt tinted the elements someone remembered.
 *
 * Each ramp is the NEUTRAL ramp's lightnesses carried onto that dye's hue, so
 * a painted card has exactly the relief and the text contrast an unpainted
 * one has. Tags that are not a hue - white, black and the two greys - are the
 * neutral ramp moved up or down instead. The values are written out rather
 * than mixed at runtime so they can be read, compared and hand-edited; they
 * were generated once from (hue, saturation, lightness shift) per tag.
 *
 * Semantic colour is deliberately NOT in here and never takes the paint: a
 * binding input, a fed plug, a tier badge and the delete button's red all
 * come from their own values, so what a card is telling you never depends on
 * what colour you painted it.
 */
export const GT_NODE_RAMPS: Record<FactoryNodeColorTag, Record<string, string>> = {
  white: {
    "--mc-100": "#6f7176",
    "--mc-93": "#636469",
    "--mc-85": "#5f6065",
    "--mc-82": "#5b5c60",
    "--mc-78": "#515256",
    "--mc-71": "#4b4c50",
    "--mc-61": "#424346",
    "--mc-56": "#3f4043",
    "--mc-55": "#3e3f42",
    "--mc-49": "#3b3c3e",
    "--mc-47": "#3a3b3d",
    "--mc-33": "#323235",
    "--mc-25": "#2c2c2e",
    "--mc-15": "#262628",
  },
  orange: {
    "--mc-100": "#845f41",
    "--mc-93": "#735339",
    "--mc-85": "#6e4f36",
    "--mc-82": "#684b33",
    "--mc-78": "#5b412d",
    "--mc-71": "#523b29",
    "--mc-61": "#463222",
    "--mc-56": "#412f20",
    "--mc-55": "#402e1f",
    "--mc-49": "#3c2b1d",
    "--mc-47": "#3a2a1d",
    "--mc-33": "#2f2217",
    "--mc-25": "#271c13",
    "--mc-15": "#1f160f",
  },
  magenta: {
    "--mc-100": "#7a4876",
    "--mc-93": "#6b3f67",
    "--mc-85": "#653c62",
    "--mc-82": "#60385d",
    "--mc-78": "#533150",
    "--mc-71": "#4c2c49",
    "--mc-61": "#40253d",
    "--mc-56": "#3b2339",
    "--mc-55": "#3a2238",
    "--mc-49": "#362034",
    "--mc-47": "#351f33",
    "--mc-33": "#2a1929",
    "--mc-25": "#231421",
    "--mc-15": "#1b101a",
  },
  light_blue: {
    "--mc-100": "#446f7e",
    "--mc-93": "#3b606e",
    "--mc-85": "#385c69",
    "--mc-82": "#355763",
    "--mc-78": "#2e4b56",
    "--mc-71": "#2a444e",
    "--mc-61": "#233a42",
    "--mc-56": "#21363d",
    "--mc-55": "#20343c",
    "--mc-49": "#1e3138",
    "--mc-47": "#1d3037",
    "--mc-33": "#17262c",
    "--mc-25": "#131f24",
    "--mc-15": "#0f191c",
  },
  yellow: {
    "--mc-100": "#827343",
    "--mc-93": "#72653b",
    "--mc-85": "#6c6038",
    "--mc-82": "#665b35",
    "--mc-78": "#594f2e",
    "--mc-71": "#51482a",
    "--mc-61": "#453d23",
    "--mc-56": "#403921",
    "--mc-55": "#3f3820",
    "--mc-49": "#3b341e",
    "--mc-47": "#39331e",
    "--mc-33": "#2e2918",
    "--mc-25": "#262214",
    "--mc-15": "#1e1b10",
  },
  lime: {
    "--mc-100": "#657e44",
    "--mc-93": "#586e3b",
    "--mc-85": "#546938",
    "--mc-82": "#4f6335",
    "--mc-78": "#45562e",
    "--mc-71": "#3e4e2a",
    "--mc-61": "#354223",
    "--mc-56": "#313d21",
    "--mc-55": "#303c20",
    "--mc-49": "#2d381e",
    "--mc-47": "#2c371d",
    "--mc-33": "#232c17",
    "--mc-25": "#1d2413",
    "--mc-15": "#161c0f",
  },
  pink: {
    "--mc-100": "#7d4c5b",
    "--mc-93": "#6d4350",
    "--mc-85": "#68404c",
    "--mc-82": "#633c48",
    "--mc-78": "#56353f",
    "--mc-71": "#4f3039",
    "--mc-61": "#432931",
    "--mc-56": "#3f262e",
    "--mc-55": "#3e262d",
    "--mc-49": "#3a232a",
    "--mc-47": "#392329",
    "--mc-33": "#2e1c22",
    "--mc-25": "#27181c",
    "--mc-15": "#1f1317",
  },
  gray: {
    "--mc-100": "#585c61",
    "--mc-93": "#4c5054",
    "--mc-85": "#484c50",
    "--mc-82": "#44474b",
    "--mc-78": "#3a3d41",
    "--mc-71": "#35373a",
    "--mc-61": "#2c2e30",
    "--mc-56": "#282a2d",
    "--mc-55": "#27292c",
    "--mc-49": "#252628",
    "--mc-47": "#242527",
    "--mc-33": "#1b1d1e",
    "--mc-25": "#161718",
    "--mc-15": "#101112",
  },
  light_gray: {
    "--mc-100": "#6d6d64",
    "--mc-93": "#606058",
    "--mc-85": "#5c5c55",
    "--mc-82": "#575750",
    "--mc-78": "#4d4d47",
    "--mc-71": "#464641",
    "--mc-61": "#3d3d38",
    "--mc-56": "#393934",
    "--mc-55": "#383834",
    "--mc-49": "#353531",
    "--mc-47": "#343430",
    "--mc-33": "#2b2b28",
    "--mc-25": "#252522",
    "--mc-15": "#1e1e1c",
  },
  cyan: {
    "--mc-100": "#437a7c",
    "--mc-93": "#3a6a6c",
    "--mc-85": "#376567",
    "--mc-82": "#345f61",
    "--mc-78": "#2d5354",
    "--mc-71": "#294b4c",
    "--mc-61": "#223f40",
    "--mc-56": "#203a3b",
    "--mc-55": "#1f393a",
    "--mc-49": "#1d3536",
    "--mc-47": "#1c3435",
    "--mc-33": "#16292a",
    "--mc-25": "#122122",
    "--mc-15": "#0e1a1a",
  },
  purple: {
    "--mc-100": "#664478",
    "--mc-93": "#583b68",
    "--mc-85": "#543863",
    "--mc-82": "#4f355d",
    "--mc-78": "#442d51",
    "--mc-71": "#3e2949",
    "--mc-61": "#33223d",
    "--mc-56": "#302038",
    "--mc-55": "#2f1f37",
    "--mc-49": "#2b1d33",
    "--mc-47": "#2a1c32",
    "--mc-33": "#211627",
    "--mc-25": "#1b121f",
    "--mc-15": "#140d18",
  },
  blue: {
    "--mc-100": "#42497a",
    "--mc-93": "#39406a",
    "--mc-85": "#363c65",
    "--mc-82": "#33395f",
    "--mc-78": "#2c3152",
    "--mc-71": "#282c4a",
    "--mc-61": "#21253e",
    "--mc-56": "#1f2239",
    "--mc-55": "#1e2238",
    "--mc-49": "#1c1f34",
    "--mc-47": "#1b1e33",
    "--mc-33": "#151828",
    "--mc-25": "#111320",
    "--mc-15": "#0d0e18",
  },
  brown: {
    "--mc-100": "#755a47",
    "--mc-93": "#654e3e",
    "--mc-85": "#604a3b",
    "--mc-82": "#5a4637",
    "--mc-78": "#4e3c30",
    "--mc-71": "#47372b",
    "--mc-61": "#3b2e24",
    "--mc-56": "#372a21",
    "--mc-55": "#352921",
    "--mc-49": "#32261e",
    "--mc-47": "#30251e",
    "--mc-33": "#261d17",
    "--mc-25": "#1e1713",
    "--mc-15": "#17120e",
  },
  green: {
    "--mc-100": "#5e7547",
    "--mc-93": "#51653e",
    "--mc-85": "#4d603b",
    "--mc-82": "#495a37",
    "--mc-78": "#3f4e30",
    "--mc-71": "#39472b",
    "--mc-61": "#2f3b24",
    "--mc-56": "#2c3721",
    "--mc-55": "#2b3521",
    "--mc-49": "#28321e",
    "--mc-47": "#27301e",
    "--mc-33": "#1e2617",
    "--mc-25": "#181e13",
    "--mc-15": "#12170e",
  },
  red: {
    "--mc-100": "#7e4844",
    "--mc-93": "#6e3f3b",
    "--mc-85": "#693c38",
    "--mc-82": "#633835",
    "--mc-78": "#56312e",
    "--mc-71": "#4e2c2a",
    "--mc-61": "#422523",
    "--mc-56": "#3d2321",
    "--mc-55": "#3c2220",
    "--mc-49": "#38201e",
    "--mc-47": "#371f1d",
    "--mc-33": "#2c1917",
    "--mc-25": "#241413",
    "--mc-15": "#1c100f",
  },
  black: {
    "--mc-100": "#4f5157",
    "--mc-93": "#43454a",
    "--mc-85": "#3f4146",
    "--mc-82": "#3b3c41",
    "--mc-78": "#323337",
    "--mc-71": "#2c2d31",
    "--mc-61": "#232427",
    "--mc-56": "#202023",
    "--mc-55": "#1f1f22",
    "--mc-49": "#1c1c1f",
    "--mc-47": "#1b1b1e",
    "--mc-33": "#131315",
    "--mc-25": "#0d0d0e",
    "--mc-15": "#070808",
  },
  // The system swatches. The four hues carry the red dye ramp's exact
  // lightness curve re-hued (saturation scaled to each swatch), steel IS the
  // neutral ramp — painting a card steel is the unpainted look, stated as a
  // choice — and onyx is the neutral ramp stepped down.
  scarlet: {
    "--mc-100": "#873b3b",
    "--mc-93": "#763333",
    "--mc-85": "#703131",
    "--mc-82": "#6a2e2e",
    "--mc-78": "#5c2828",
    "--mc-71": "#532525",
    "--mc-61": "#471e1e",
    "--mc-56": "#411d1d",
    "--mc-55": "#401c1c",
    "--mc-49": "#3c1a1a",
    "--mc-47": "#3b1919",
    "--mc-33": "#2f1414",
    "--mc-25": "#271010",
    "--mc-15": "#1e0d0d",
  },
  amber: {
    "--mc-100": "#826b40",
    "--mc-93": "#715d38",
    "--mc-85": "#6c5935",
    "--mc-82": "#665432",
    "--mc-78": "#59492b",
    "--mc-71": "#504228",
    "--mc-61": "#443821",
    "--mc-56": "#3f341f",
    "--mc-55": "#3e331e",
    "--mc-49": "#3a2f1c",
    "--mc-47": "#392e1b",
    "--mc-33": "#2d2516",
    "--mc-25": "#251e12",
    "--mc-15": "#1d180e",
  },
  emerald: {
    "--mc-100": "#3b876e",
    "--mc-93": "#337660",
    "--mc-85": "#31705b",
    "--mc-82": "#2e6a56",
    "--mc-78": "#285c4b",
    "--mc-71": "#255344",
    "--mc-61": "#1e4739",
    "--mc-56": "#1d4135",
    "--mc-55": "#1c4034",
    "--mc-49": "#1a3c31",
    "--mc-47": "#193b30",
    "--mc-33": "#142f26",
    "--mc-25": "#10271f",
    "--mc-15": "#0d1e18",
  },
  azure: {
    "--mc-100": "#3b5887",
    "--mc-93": "#334d76",
    "--mc-85": "#314970",
    "--mc-82": "#2e456a",
    "--mc-78": "#283c5c",
    "--mc-71": "#253653",
    "--mc-61": "#1e2e47",
    "--mc-56": "#1d2b41",
    "--mc-55": "#1c2a40",
    "--mc-49": "#1a273c",
    "--mc-47": "#19263b",
    "--mc-33": "#141e2f",
    "--mc-25": "#101927",
    "--mc-15": "#0d131e",
  },
  steel: {
    "--mc-100": "#5a5c65",
    "--mc-93": "#4e5058",
    "--mc-85": "#4a4c54",
    "--mc-82": "#46484f",
    "--mc-78": "#3c3e45",
    "--mc-71": "#36383f",
    "--mc-61": "#2d2f35",
    "--mc-56": "#2a2c31",
    "--mc-55": "#292b30",
    "--mc-49": "#26282d",
    "--mc-47": "#25272c",
    "--mc-33": "#1d1f23",
    "--mc-25": "#17191d",
    "--mc-15": "#111317",
  },
  onyx: {
    "--mc-100": "#4f5159",
    "--mc-93": "#43454c",
    "--mc-85": "#3f4148",
    "--mc-82": "#3b3d43",
    "--mc-78": "#313339",
    "--mc-71": "#2b2d33",
    "--mc-61": "#222429",
    "--mc-56": "#1f2125",
    "--mc-55": "#1e2024",
    "--mc-49": "#1b1d21",
    "--mc-47": "#1b1c20",
    "--mc-33": "#131416",
    "--mc-25": "#0d0e10",
    "--mc-15": "#07080a",
  },
};

export interface NodeSurfaceColor {
  swatch: string;
  panel: string;
  header: string;
  border: string;
  shadow: string;
}

/**
 * The custom rate card's own colour: the app's blue, not a dye off the
 * player's palette, so painting one still works and still wins.
 */
export const CUSTOM_RATE_NODE_COLOR: NodeSurfaceColor = GT_NODE_COLORS.blue;

/** The ramp a card wears, painted or not. Undefined means the neutral one. */
export function rampFor(tag: FactoryNodeColorTag | undefined): Record<string, string> | undefined {
  return tag ? GT_NODE_RAMPS[tag] : undefined;
}

/**
 * The heatmap's ramp: the same construction as a paint tag's, mixed live off
 * the heat colour because heat is continuous and cannot be a preset. It is a
 * VIEW, not a card's colour, so it is allowed to be derived.
 */
export function heatmapRamp(panel: string): Record<string, string> {
  const stops: Record<string, string> = {};
  for (const [token, neutral] of Object.entries(GT_NODE_RAMPS.gray)) {
    stops[token] = mixHex(neutral, panel, 0.34);
  }
  return stops;
}

/**
 * A SECTOR's ramp: the neutral ramp pulled a little toward the sector's hue,
 * so a power or crop card is a different material through and through - name
 * bar, wells, tiles, bevels, footer - not a coloured ground under grey parts.
 * Kept faint on purpose: the card must still read as a card, and its
 * semantic colours (verdict inks, tier badges, the delete red) never take it.
 */
function sectorRamp(hue: string, amount: number): Record<string, string> {
  const stops: Record<string, string> = {};
  for (const [token, neutral] of Object.entries(GT_NODE_RAMPS.gray)) {
    const step = Number(token.slice("--mc-".length));
    // Mixing every stop toward one hue flattens the relief - the wells and
    // tiles sank into the face ("like looking through glass"). So the stops
    // below the face take half the tint and a push toward black, and the
    // stops above it a push toward white, which keeps the parts distinct.
    const tinted = mixHex(neutral, hue, step < 78 ? amount * 0.5 : amount);
    stops[token] =
      step < 78 ? mixHex(tinted, "#000000", 0.12) : step > 78 ? mixHex(tinted, "#ffffff", 0.06) : tinted;
  }
  return stops;
}

/** The power sector: the neutral ramp warmed toward amber. */
export const POWER_CARD_RAMP = sectorRamp("#d99a2b", 0.14);
/** The crop sector: the same, toward leaf green. */
export const CROP_CARD_RAMP = sectorRamp("#4f8c33", 0.2);

function mixHex(from: string, to: string, amount: number): string {
  const channel = (hex: string, offset: number) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16);
  const blend = (offset: number) =>
    Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${blend(1)}${blend(3)}${blend(5)}`;
}

/**
 * The heatmap ramp: red at idle, amber at half, green at full blast.
 *
 * Deliberately NOT the cold-to-hot ramp a heatmap usually implies. Everywhere
 * else on this board red means "act here" and green means "done", and a mode
 * where red suddenly meant "running beautifully" would poison that reading.
 * So the question this answers is "where is my capacity going to waste?" — the
 * loudest nodes are the ones with the most slack.
 */
const HEAT_STOPS: Array<{ at: number; color: string }> = [
  { at: 0, color: "#b02e26" },
  { at: 0.5, color: "#c8a929" },
  { at: 1, color: "#5e7c16" },
];

/** A machine that is switched off has no heat to report — it reads neutral. */
const HEAT_OFF: NodeSurfaceColor = {
  swatch: "#6b6f70",
  panel: "#6b6f70",
  header: "#565e61",
  border: "#33383a",
  shadow: "#474f52",
};

/** The neutral card the glance views hand to nodes with nothing to say. */
export const GLANCE_NEUTRAL_SURFACE: NodeSurfaceColor = HEAT_OFF;

/**
 * A whole card surface from one base hue — the heatmap's own construction,
 * shared by every glance view that colours cards (speed by heat, usage by
 * reason, power by tier), so a red card means the same KIND of red in each.
 */
export function glanceSurfaceFor(base: string): NodeSurfaceColor {
  return {
    swatch: base,
    // The card body is the ramp muted toward the panel grey, so the colour
    // reads as a wash rather than as a solid block of paint behind the text.
    panel: mixHex(base, "#8a8a8a", 0.42),
    header: mixHex(base, "#8a8a8a", 0.18),
    border: mixHex(base, "#101010", 0.42),
    shadow: base,
  };
}

export function heatmapColorFor(
  utilization: number | undefined,
  enabled = true,
): NodeSurfaceColor {
  if (!enabled || utilization === undefined || !Number.isFinite(utilization)) {
    return HEAT_OFF;
  }
  const value = Math.min(Math.max(utilization, 0), 1);
  let base = HEAT_STOPS[HEAT_STOPS.length - 1]!.color;
  for (let index = 0; index < HEAT_STOPS.length - 1; index += 1) {
    const low = HEAT_STOPS[index]!;
    const high = HEAT_STOPS[index + 1]!;
    if (value <= high.at) {
      const span = high.at - low.at;
      base = mixHex(low.color, high.color, span > 0 ? (value - low.at) / span : 0);
      break;
    }
  }
  return glanceSurfaceFor(base);
}

/**
 * The zoomed-out figure's ink on a glance-coloured card: the surface's own
 * hue lifted well toward white, so the number reads as an accent OF the card
 * rather than as a verdict colour laid over it.
 */
export function glanceAccentFor(surface: NodeSurfaceColor): string {
  return mixHex(surface.swatch, "#f5f7fa", 0.62);
}

/**
 * The card face a glance view paints, delivered as INERT custom properties.
 *
 * They are inline on the node every render but mean nothing there: only the
 * `[data-detail-level="glance"]` rules in globals.css read them, which is what
 * makes every view LOD-only without a single React subscription to the zoom —
 * the same trick the hop map uses. The face and bevels reuse the heatmap
 * ramp's mix (the neutral grey ramp pulled 34% toward the wash) so a glance
 * card keeps exactly the relief an unpainted card has.
 */
export function glanceCardVars(surface: NodeSurfaceColor): Record<string, string> {
  return {
    "--glance-face": mixHex(GT_NODE_RAMPS.gray["--mc-78"]!, surface.panel, 0.34),
    "--glance-bevel-light": mixHex(GT_NODE_RAMPS.gray["--mc-100"]!, surface.panel, 0.34),
    "--glance-bevel-dark": mixHex(GT_NODE_RAMPS.gray["--mc-33"]!, surface.panel, 0.34),
    "--glance-border": surface.border,
    "--glance-ring": surface.shadow,
  };
}

/**
 * The same ramp the heatmap uses, as a bare colour — for lines in flow mode,
 * where the reading is "how much moves here" rather than "how busy is this
 * machine". One ramp across both so a red line and a red node mean the same
 * kind of thing: the quiet end of the scale.
 */
export function flowRampColor(normalized: number): string {
  return heatmapColorFor(normalized).swatch;
}

export const GT_NODE_COLOR_TAGS = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
  // The system row: the app's own inks, after the sixteen dyes.
  "scarlet",
  "amber",
  "emerald",
  "azure",
  "steel",
  "onyx",
] satisfies FactoryNodeColorTag[];

export const GT_NODE_COLOR_PALETTE: Array<{
  tag: FactoryNodeColorTag;
  color: (typeof GT_NODE_COLORS)[FactoryNodeColorTag];
}> = GT_NODE_COLOR_TAGS.map((tag) => ({
  tag,
  color: GT_NODE_COLORS[tag],
}));
