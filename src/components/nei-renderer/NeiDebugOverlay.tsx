"use client";

import type { NeiDrawCommand } from "@/lib/nei-renderer/core/commands";
import { NEI_TEXTURES } from "@/lib/nei-renderer/theme/textures";

export function NeiDebugOverlay({
  command,
  scale,
}: {
  command: Extract<NeiDrawCommand, { type: "texture" | "progress" | "rect" }>;
  scale: number;
}) {
  if (command.type === "rect") {
    return (
      <div
        className="pointer-events-none absolute"
        style={{
          left: command.x * scale,
          top: command.y * scale,
          width: command.width * scale,
          height: command.height * scale,
          backgroundColor: command.color,
          border: command.borderColor
            ? `${Math.max(1, scale)}px solid ${command.borderColor}`
            : undefined,
          opacity: command.opacity,
        }}
      />
    );
  }

  if (command.type === "progress") {
    const frameOffset =
      command.frame === undefined ? undefined : command.frame * command.height * scale;
    return (
      <div
        className="pointer-events-none absolute"
        style={{
          left: command.x * scale,
          top: command.y * scale,
          width: command.width * scale,
          height: command.height * scale,
          backgroundImage: `url('${NEI_TEXTURES.progressBar(command.texture ?? "arrow")}')`,
          backgroundPosition: frameOffset === undefined ? "top left" : `0 -${frameOffset}px`,
          backgroundSize: frameOffset === undefined ? "100% 200%" : "100% auto",
        }}
      />
    );
  }

  const hasSource =
    command.sourceWidth && command.sourceHeight && command.textureWidth && command.textureHeight;
  const scaleX = hasSource ? (command.width * scale) / command.sourceWidth! : 1;
  const scaleY = hasSource ? (command.height * scale) / command.sourceHeight! : 1;
  return (
    <div
      className="pointer-events-none absolute bg-no-repeat"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        opacity: command.opacity,
        backgroundImage: `url('${command.imagePath}')`,
        backgroundSize: hasSource
          ? `${command.textureWidth! * scaleX}px ${command.textureHeight! * scaleY}px`
          : "100% 100%",
        backgroundPosition: hasSource
          ? `-${(command.sourceX ?? 0) * scaleX}px -${(command.sourceY ?? 0) * scaleY}px`
          : undefined,
      }}
    />
  );
}
