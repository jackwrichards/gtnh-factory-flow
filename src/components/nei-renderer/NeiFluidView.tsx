"use client";

import type { ComponentProps } from "react";
import type { NeiFluidCommand } from "@/lib/nei-renderer/core/commands";
import { StackIconButton } from "./NeiItemView";

export function NeiFluidView({
  command,
  ...props
}: Omit<ComponentProps<typeof StackIconButton>, "command"> & { command: NeiFluidCommand }) {
  return <StackIconButton command={{ ...command, type: "item", layer: "item" }} {...props} />;
}
