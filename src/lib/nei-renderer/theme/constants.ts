export const NEI_BASE_RECIPE_WIDTH = 170;
export const NEI_DEFAULT_HANDLER_WIDTH = 170;
export const NEI_DEFAULT_HANDLER_HEIGHT = 82;
export const NEI_ITEM_SLOT_SIZE = 18;
export const NEI_ITEM_ICON_SIZE = 36;
export const NEI_FLUID_SLOT_SIZE = 18;
export const NEI_ASPECT_SLOT_SIZE = 18;
export const NEI_DEFAULT_PADDING = 8;

export const NEI_TEXT_COLORS = {
  black: "#111111",
  white: "#ffffff",
  shadow: "#3f3f3f",
  muted: "#4a4a4a",
  thaumcraft: "#3b205c",
};

export const NEI_LAYER_Z_INDEX = {
  chrome: 0,
  background: 1,
  decoration: 2,
  slot: 10,
  item: 20,
  fluid: 20,
  aspect: 20,
  progress: 8,
  text: 30,
  stats: 35,
  overlay: 45,
  debug: 80,
} as const;
