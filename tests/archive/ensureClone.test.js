import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import { ensureClone } from "../../src/archive/ensureClone.js";
import { Manifest } from "../../src/archive/manifest.js";
import * as fsx from "../../src/fsx.js";

async function createTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ps-ensure-"));
}

describe("ensureClone", () => {
  let tmpDir;
  let manifest;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    manifest = new Manifest(path.join(tmpDir, "archive"));
    await fs.mkdir(path.join(tmpDir, "archive"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates on first run", async () => {
    const root = path.join(tmpDir, "archive");
    const src = path.join(tmpDir, "photo-a.jpg");
    const dest = path.join(root, "photo-a.jpg");
    await fs.writeFile(src, "data-a");
    const result = await ensureClone(src, dest, { manifest, root });
    expect(result).toBe("created");
    const rel = path.relative(root, dest);
    expect(manifest.get(rel)).toBeDefined();
  });

  it("skips when fingerprint matches", async () => {
    const root = path.join(tmpDir, "archive");
    const src = path.join(tmpDir, "photo-b.jpg");
    const dest = path.join(root, "photo-b.jpg");
    await fs.writeFile(src, "data-b");
    await ensureClone(src, dest, { manifest, root });
    const result = await ensureClone(src, dest, { manifest, root });
    expect(result).toBe("skipped");
  });

  it("refreshes when the source changes", async () => {
    const root = path.join(tmpDir, "archive");
    const src = path.join(tmpDir, "photo-c.jpg");
    const dest = path.join(root, "photo-c.jpg");
    await fs.writeFile(src, "data-c");
    await ensureClone(src, dest, { manifest, root });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(src, "data-c-updated");
    const result = await ensureClone(src, dest, { manifest, root });
    expect(result).toBe("refreshed");
  });

  it("reports created when clone falls back to copy", async () => {
    const root = path.join(tmpDir, "archive");
    const src = path.join(tmpDir, "photo-d.jpg");
    const dest = path.join(root, "photo-d.jpg");
    await fs.writeFile(src, "data-d");
    const spy = vi
      .spyOn(fsx, "cloneIfMissing")
      .mockResolvedValue({ status: "copied", mode: "copy" });
    const result = await ensureClone(src, dest, { manifest, root });
    expect(result).toBe("created");
    expect(spy).toHaveBeenCalled();
  });
});
