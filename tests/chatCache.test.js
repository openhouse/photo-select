import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let cacheDir;

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-cache-"));
  process.env.PHOTO_SELECT_CHAT_CACHE_DIR = cacheDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.PHOTO_SELECT_CHAT_CACHE_DIR;
  await fs.rm(cacheDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("chatCache", () => {
  it("skips writing when zero decisions", async () => {
    const { writeCache } = await import("../src/chatCache.js");
    await writeCache("a", { decisions: [] });
    const files = await fs.readdir(cacheDir);
    expect(files.length).toBe(0);
  });

  it("evicts zero-decision entries on read", async () => {
    const { readCache } = await import("../src/chatCache.js");
    const file = path.join(cacheDir, "b.json");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ decisions: [] }), "utf8");
    const val = await readCache("b");
    expect(val).toBeNull();
    await expect(fs.stat(file)).rejects.toThrow();
  });
});

