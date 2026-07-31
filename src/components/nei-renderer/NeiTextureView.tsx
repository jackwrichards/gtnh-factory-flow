"use client";

import type { NeiTextureCommand } from "@/lib/nei-renderer/core/commands";

export function NeiTextureView({ command, scale }: { command: NeiTextureCommand; scale: number }) {
  const hasSprite =
    command.sourceWidth !== undefined &&
    command.sourceHeight !== undefined &&
    command.textureWidth !== undefined &&
    command.textureHeight !== undefined;
  const scaleX = hasSprite ? (command.width * scale) / command.sourceWidth! : 1;
  const scaleY = hasSprite ? (command.height * scale) / command.sourceHeight! : 1;

  return (
    <div
      className="minecraft-pixel-art pointer-events-none absolute bg-no-repeat"
      data-nei-command="texture"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        opacity: command.opacity,
        backgroundImage: `url('${command.imagePath}')`,
        backgroundSize: hasSprite
          ? `${command.textureWidth! * scaleX}px ${command.textureHeight! * scaleY}px`
          : "100% 100%",
        backgroundPosition: hasSprite
          ? `-${(command.sourceX ?? 0) * scaleX}px -${(command.sourceY ?? 0) * scaleY}px`
          : undefined,
      }}
    />
  );
}
