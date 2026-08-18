// The per-world memory: one small JSON file per world under a directory
// (default ./gtnh-agent-memory). This is the "it remembers you across
// sessions" half of "learns how you play" — base location, what's been built,
// notes. One file per world keeps it trivial to inspect by hand and to back up.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MemoryStore, WorldMemory } from "./types";

export interface FileMemoryStoreOptions {
  /** Directory to hold one JSON file per world. Defaults to ./gtnh-agent-memory. */
  dir?: string;
}

export class FileMemoryStore implements MemoryStore {
  private dir: string;

  constructor(options: FileMemoryStoreOptions = {}) {
    this.dir = options.dir ?? path.join(process.cwd(), "gtnh-agent-memory");
  }

  private fileFor(worldName: string): string {
    // One file per world. World names can contain path separators or odd
    // characters, so encode the whole name before using it as a filename.
    return path.join(this.dir, `${encodeURIComponent(worldName)}.json`);
  }

  async load(worldName: string): Promise<WorldMemory> {
    try {
      const raw = await fs.readFile(this.fileFor(worldName), "utf8");
      const data = JSON.parse(raw) as Partial<WorldMemory>;
      return {
        worldName,
        base: data.base,
        builtMachines: data.builtMachines ?? {},
        notes: data.notes ?? [],
        updatedAt: data.updatedAt,
      };
    } catch {
      // No file yet (or a corrupt one) — start fresh. A bad memory file must
      // never take the agent down.
      return { worldName, builtMachines: {}, notes: [] };
    }
  }

  async save(memory: WorldMemory): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.fileFor(memory.worldName);
    // Write-then-rename so a crash never leaves a half-written memory file.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(memory, null, 2), "utf8");
    await fs.rename(tmp, file);
  }
}
