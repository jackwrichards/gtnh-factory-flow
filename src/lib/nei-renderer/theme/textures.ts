const THAUMCRAFT_ASPECT_ICON_ROOT = "/nei/thaumcraft/aspects";
const THAUMCRAFT_UNKNOWN_ASPECT = `${THAUMCRAFT_ASPECT_ICON_ROOT}/_unknown.png`;

const KNOWN_THAUMCRAFT_ASPECTS = new Set([
  "aer",
  "alienis",
  "aqua",
  "arbor",
  "auram",
  "bestia",
  "cognitio",
  "corpus",
  "exanimis",
  "fabrico",
  "fames",
  "gelum",
  "herba",
  "humanus",
  "ignis",
  "instrumentum",
  "iter",
  "limus",
  "lucrum",
  "lux",
  "machina",
  "messis",
  "metallum",
  "meto",
  "mortuus",
  "motus",
  "ordo",
  "pannus",
  "perditio",
  "perfodio",
  "permutatio",
  "potentia",
  "praecantatio",
  "sano",
  "sensus",
  "spiritus",
  "telum",
  "tempestas",
  "tenebrae",
  "terra",
  "tutamen",
  "vacuos",
  "venenum",
  "victus",
  "vinculum",
  "vitium",
  "vitreus",
  "volatus",
]);

export function normalizeThaumcraftAspectId(aspectIdOrTag: string): string {
  const normalized = aspectIdOrTag.trim().toLowerCase().replace(/\\/g, "/");
  const fileName = normalized.split("/").at(-1) ?? normalized;
  const withoutExtension = fileName.endsWith(".png") ? fileName.slice(0, -4) : fileName;
  const withoutPrefix = withoutExtension.startsWith("thaumcraft:aspect:")
    ? withoutExtension.slice("thaumcraft:aspect:".length)
    : withoutExtension;
  const tag = withoutPrefix.includes(":") ? withoutPrefix.split(":").at(-1) : withoutPrefix;
  return (tag ?? "").replace(/[^a-z0-9_]/g, "");
}

export function thaumcraftAspectIcon(aspectIdOrTag: string): string {
  const tag = normalizeThaumcraftAspectId(aspectIdOrTag);
  return tag && KNOWN_THAUMCRAFT_ASPECTS.has(tag)
    ? `${THAUMCRAFT_ASPECT_ICON_ROOT}/${tag}.png`
    : THAUMCRAFT_UNKNOWN_ASPECT;
}

export function resolveThaumcraftAspectIconPath(
  aspectIdOrTag: string,
  explicitIconPath?: string,
): string {
  return explicitIconPath || thaumcraftAspectIcon(aspectIdOrTag);
}

export const NEI_TEXTURES = {
  gregtechRecipeBackground: "/nei/gregtech/gui/background/nei_single_recipe.png",
  itemSlot: "/nei/modularui/gui/slot/item.png",
  fluidSlot: "/nei/modularui/gui/slot/fluid.png",
  aspectSlot: "/nei/modularui/gui/slot/aspect.png",
  thaumcraftUnknownAspect: THAUMCRAFT_UNKNOWN_ASPECT,
  thaumcraftResearchOverlay: "/nei/thaumcraft/gui/gui_researchbook_overlay.png",
  thaumcraftAspectIcon,
  resolveThaumcraftAspectIconPath,
  normalizeThaumcraftAspectId,
  progressBar: (texture: string) => `/nei/gregtech/gui/progressbar/${texture}.png`,
  slot: (kind: string) =>
    kind === "aspect"
      ? "/nei/modularui/gui/slot/aspect.png"
      : `/nei/modularui/gui/slot/${kind}.png`,
};
