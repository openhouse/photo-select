import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import { constants as C } from "node:fs";

async function createTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ps-fsx-"));
}

describe("cloneIfMissing", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("clones when destination is absent", async () => {
    const { cloneIfMissing } = await import("../src/fsx.js");
    const src = path.join(tmpDir, "a.txt");
    const dest = path.join(tmpDir, "b.txt");
    await fs.writeFile(src, "alpha");
    const result = await cloneIfMissing(src, dest);
    expect(["cloned", "copied"]).toContain(result.status);
    expect(await fs.readFile(dest, "utf8")).toBe("alpha");
  });

  it("skips when the destination matches the source", async () => {
    const { cloneIfMissing } = await import("../src/fsx.js");
    const src = path.join(tmpDir, "c.txt");
    const dest = path.join(tmpDir, "d.txt");
    await fs.writeFile(src, "alpha");
    await cloneIfMissing(src, dest);
    const result = await cloneIfMissing(src, dest);
    expect(result.status).toBe("skipped");
  });

  it("refreshes when the source changes", async () => {
    const { cloneIfMissing } = await import("../src/fsx.js");
    const src = path.join(tmpDir, "e.txt");
    const dest = path.join(tmpDir, "f.txt");
    await fs.writeFile(src, "alpha");
    await cloneIfMissing(src, dest);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(src, "beta-extended");
    const result = await cloneIfMissing(src, dest);
    expect(result.status).toBe("updated");
    expect(await fs.readFile(dest, "utf8")).toBe("beta-extended");
  });

  it("falls back to copy when clone is not supported", async () => {
    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual("node:fs/promises");
      return {
        ...actual,
        copyFile: vi.fn(async (source, target, flags) => {
          if (flags === (C.COPYFILE_FICLONE | C.COPYFILE_EXCL)) {
            const err = new Error("not supported");
            err.code = "ENOTSUP";
            throw err;
          }
          return actual.copyFile(source, target, flags);
        }),
      };
    });
    const { cloneIfMissing } = await import("../src/fsx.js");
    const src = path.join(tmpDir, "g.txt");
    const dest = path.join(tmpDir, "h.txt");
    await fs.writeFile(src, "gamma");
    const result = await cloneIfMissing(src, dest);
    expect(result.status).toBe("copied");
    expect(await fs.readFile(dest, "utf8")).toBe("gamma");
    vi.doUnmock("node:fs/promises");
  });
});
