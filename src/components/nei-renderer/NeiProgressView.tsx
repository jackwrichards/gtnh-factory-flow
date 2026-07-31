"use client";

import type { NeiProgressCommand } from "@/lib/nei-renderer/core/commands";
import { NEI_TEXTURES } from "@/lib/nei-renderer/theme/textures";

export function NeiProgressView({
  command,
  scale,
}: {
  command: NeiProgressCommand;
  scale: number;
}) {
  const frameOffset = command.frame === undefined ? 0 : command.frame * command.height * scale;

  return (
    <div
      className="minecraft-pixel-art pointer-events-none absolute bg-no-repeat"
      data-nei-command="progress"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        backgroundImage: `url('${NEI_TEXTURES.progressBar(command.texture ?? "arrow")}')`,
        backgroundPosition: `0 -${frameOffset}px`,
        backgroundSize: `${command.width * scale}px auto`,
      }}
    />
  );
}
