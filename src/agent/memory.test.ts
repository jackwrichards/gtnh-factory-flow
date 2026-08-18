import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileMemoryStore } from "./memory";
import type { WorldMemory } from "./types";

describe("FileMemoryStore", () => {
  let dir: string;
  let store: FileMemoryStore;

  // One throwaway dir per test, under the OS temp folder, removed afterwards.
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `agent-mem-${randomUUID()}`);
    store = new FileMemoryStore({ dir });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns a fresh memory for an unseen world", async () => {
    const mem = await store.load("brand-new-world");
    expect(mem).toEqual({ worldName: "brand-new-world", builtMachines: {}, notes: [] });
  });

  it("round-trips a memory through the disk", async () => {
    const memory: WorldMemory = {
      worldName: "skybase",
      base: { x: 100, y: 64, z: -200 },
      builtMachines: { Furnace: 2, "Electric Blast Furnace": 1 },
      notes: ["player prefers HVA coils", "base faces south"],
      updatedAt: "2026-08-18T00:00:00.000Z",
    };
    await store.save(memory);
    const loaded = await store.load("skybase");
    expect(loaded).toEqual(memory);
  });

  it("keeps separate worlds from colliding", async () => {
    await store.save({ worldName: "a", builtMachines: { Furnace: 1 }, notes: ["note-a"] });
    const a = await store.load("a");
    const b = await store.load("b");
    expect(a.notes).toEqual(["note-a"]);
    expect(b.notes).toEqual([]);
    expect(b.builtMachines).toEqual({});
  });

  it("recovers from a corrupt memory file instead of throwing", async () => {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${encodeURIComponent("bad-world")}.json`);
    await fs.writeFile(file, "{ not valid json", "utf8");
    const mem = await store.load("bad-world");
    expect(mem).toEqual({ worldName: "bad-world", builtMachines: {}, notes: [] });
  });
});
