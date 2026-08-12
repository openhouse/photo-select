import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

describe("--needs-review-retries", () => {
  it("advertises a per-level automatic repair limit", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["src/index.js", "--help"],
      { cwd: process.cwd() }
    );

    expect(stdout).toContain("--needs-review-retries <n>");
    expect(stdout).toMatch(/automatic repair passes per level/i);
  });

  it("rejects zero instead of silently changing it to one", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        ["src/index.js", "--needs-review-retries", "0"],
        { cwd: process.cwd() }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("must be a positive integer"),
    });
  });

  it("forwards the configured limit to the recursive scheduler", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-cli-review-retries-"));
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "src/index.js",
          "--provider",
          "ollama",
          "--dir",
          dir,
          "--retry-needs-review",
          "--needs-review-retries",
          "2",
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, OPENAI_API_KEY: "test" },
        }
      );

      expect(stdout).toContain("needs-review-retries=2");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
