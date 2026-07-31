"use client";

import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import type { NeiTextCommand } from "@/lib/nei-renderer/core/commands";

const NEI_TEXT_CLASS =
  "pointer-events-none absolute overflow-hidden whitespace-nowrap font-mono [text-rendering:geometricPrecision]";

export function NeiTextView({ command, scale }: { command: NeiTextCommand; scale: number }) {
  const color = command.color ?? "#111";
  const text = (
    <div
      className={NEI_TEXT_CLASS}
      data-nei-command="text"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width ? command.width * scale : undefined,
        height: command.height ? command.height * scale : undefined,
        color,
        fontFamily: "var(--font-minecraft), monospace",
        fontSize: (command.fontSize ?? 8) * scale,
        lineHeight: `${(command.fontSize ?? 8) * scale}px`,
        textAlign: command.align,
        textShadow: color.toLowerCase() === "#ffffff" ? `${scale}px ${scale}px 0 #3f3f3f` : undefined,
      }}
    >
      {command.text}
    </div>
  );

  return command.tooltip ? (
    <MinecraftTooltip label={command.tooltip}>{text}</MinecraftTooltip>
  ) : (
    text
  );
}
