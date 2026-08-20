import type { MachineTier } from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;

export const GT_TIER_COLORS: Record<
  VoltageTier,
  { background: string; border: string; text: string; shadow: string }
> = {
  ULV: { background: "#565656", border: "#222222", text: "#f7f7f7", shadow: "#111111" },
  LV: { background: "#8b8b8b", border: "#3f3f3f", text: "#ffffff", shadow: "#4a4a4a" },
  MV: { background: "#c9862e", border: "#744613", text: "#ffffff", shadow: "#7a4b1e" },
  HV: { background: "#d6bd2b", border: "#867314", text: "#111111", shadow: "#8f7d16" },
  EV: { background: "#8f72c9", border: "#4f347f", text: "#ffffff", shadow: "#4d3a76" },
  IV: { background: "#5776c9", border: "#273f89", text: "#ffffff", shadow: "#2c4078" },
  LuV: { background: "#d28bd0", border: "#854682", text: "#111111", shadow: "#8a4f87" },
  ZPM: { background: "#d044b8", border: "#7a246b", text: "#ffffff", shadow: "#7c2b70" },
  UV: { background: "#35b7b2", border: "#176d69", text: "#071b1a", shadow: "#1d726f" },
  UHV: { background: "#cf2f2f", border: "#751919", text: "#ffffff", shadow: "#7d2020" },
  UEV: { background: "#2f2f2f", border: "#090909", text: "#ffffff", shadow: "#111111" },
  UIV: { background: "#f1f1f1", border: "#969696", text: "#111111", shadow: "#aaaaaa" },
  UMV: { background: "#55dfe6", border: "#16868b", text: "#071b1a", shadow: "#1a9197" },
  UXV: { background: "#2dd36f", border: "#146b38", text: "#06180c", shadow: "#18743d" },
  MAX: { background: "#ff5bd6", border: "#8c2172", text: "#111111", shadow: "#9a2b7f" },
};
