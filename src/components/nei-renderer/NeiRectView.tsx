"use client";

import type { NeiRectCommand } from "@/lib/nei-renderer/core/commands";

export function NeiRectView({ command, scale }: { command: NeiRectCommand; scale: number }) {
  return (
    <div
      className="pointer-events-none absolute"
      data-nei-command="rect"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        boxSizing: "border-box",
        backgroundColor: command.color,
        border: command.borderColor
          ? `${Math.max(1, Math.round(scale))}px solid ${command.borderColor}`
          : undefined,
        opacity: command.opacity,
      }}
    />
  );
}
