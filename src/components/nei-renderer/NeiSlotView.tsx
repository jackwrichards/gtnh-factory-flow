"use client";

import type { NeiSlotCommand } from "@/lib/nei-renderer/core/commands";

export function NeiSlotView({ command, scale }: { command: NeiSlotCommand; scale: number }) {
  const hasTexture = command.framed !== false && Boolean(command.texturePath);

  return (
    <div
      className="minecraft-pixel-art pointer-events-none absolute bg-no-repeat"
      data-nei-command="slot"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        backgroundColor:
          command.framed === false || hasTexture ? undefined : "rgba(0, 0, 0, 0.18)",
        backgroundImage: hasTexture ? `url('${command.texturePath}')` : undefined,
        backgroundSize: hasTexture ? "100% 100%" : undefined,
      }}
    />
  );
}
