import type { NeiDrawCommand } from "./commands";

export interface NeiRenderTarget {
  id?: string;
}

export interface NeiRenderer {
  draw(commands: NeiDrawCommand[], target: NeiRenderTarget): void;
}
