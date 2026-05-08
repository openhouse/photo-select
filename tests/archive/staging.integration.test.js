import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import { ensureArchiveLevel } from "../../src/archive/ensureArchiveLevel.js";
import * as fsx from "../../src/fsx.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ps-stage-"));
}

describe("ensureArchiveLevel integration", () => {
  let tmpDir;
  let levelDir;
  let files;
  let logSpy;
  let warnSpy;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    levelDir = path.join(tmpDir, "_level-001");
    await fs.mkdir(levelDir, { recursive: true });
    files = [];
    for (const name of ["a.jpg", "b.jpg", "c.jpg"]) {
      const file = path.join(tmpDir, name);
      await fs.writeFile(file, name);
      files.push(file);
    }
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("stages once and skips on resume", async () => {
    const first = await ensureArchiveLevel({
      levelDir,
      files,
      update: true,
      verbose: false,
    });
    expect(first.created).toBe(files.length);
    expect(first.errors).toBe(0);
    const stagedLog = await fs.readFile(path.join(levelDir, ".staged.jsonl"), "utf8");
    expect(stagedLog.trim().split("\n").filter(Boolean).length).toBe(files.length);
    await expect(fs.stat(path.join(levelDir, ".ok"))).resolves.toBeTruthy();

    const cloneSpy = vi.spyOn(fsx, "cloneIfMissing").mockImplementation(async () => {
      throw new Error("clone should not be called on resume");
    });

    const second = await ensureArchiveLevel({
      levelDir,
      files,
      update: true,
      verbose: false,
    });
    expect(second.skipped).toBe(files.length);
    expect(second.created).toBe(0);
    expect(cloneSpy).not.toHaveBeenCalled();

    const runData = JSON.parse(
      await fs.readFile(path.join(levelDir, ".run.json"), "utf8")
    );
    expect(runData.cloned).toBeGreaterThanOrEqual(files.length);
  });

  it("appends late files after .ok exists", async () => {
    const first = await ensureArchiveLevel({
      levelDir,
      files,
      update: true,
      verbose: false,
    });
    expect(first.created).toBe(files.length);
    await expect(fs.stat(path.join(levelDir, ".ok"))).resolves.toBeTruthy();

    const late = path.join(tmpDir, "new.jpg");
    await fs.writeFile(late, "new");
    const second = await ensureArchiveLevel({
      levelDir,
      files: [late],
      update: true,
      verbose: false,
    });

    expect(second.created).toBe(1);
    await expect(fs.stat(path.join(levelDir, "new.jpg"))).resolves.toBeTruthy();
    const stagedLog = await fs.readFile(path.join(levelDir, ".staged.jsonl"), "utf8");
    expect(stagedLog).toContain("new.jpg");
  });

});
