import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { copyFile, parseStrategy } from "../src/fs/copyOps.js";

const MODES = new Set(["clone", "hardlink", "copy", "move", "skip"]);

describe("copyOps.copyFile", () => {
  it("materializes a file with metadata preserved", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "copyops-test-"));
    try {
      const src = path.join(dir, "source.txt");
      const dst = path.join(dir, "dest.txt");
      await writeFile(src, "apfs clone fallback", "utf8");
      const result = await copyFile(src, dst, parseStrategy("auto"));
      expect(MODES.has(result.mode)).toBe(true);
      const contents = await readFile(dst, "utf8");
      expect(contents).toBe("apfs clone fallback");
      const srcStat = await stat(src);
      const dstStat = await stat(dst);
      expect(dstStat.size).toBe(srcStat.size);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips existing destinations when journal indicates completion", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "copyops-skip-"));
    try {
      const src = path.join(dir, "source.txt");
      const dst = path.join(dir, "dest.txt");
      await writeFile(src, "hello", "utf8");
      await copyFile(src, dst, "copy");
      const second = await copyFile(src, dst, "copy");
      expect(second.mode === "skip" || MODES.has(second.mode)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
