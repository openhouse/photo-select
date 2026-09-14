import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

describe("--target-level-size", () => {
  it("is advertised as an optional completed-level stopping target", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["src/index.js", "--help"],
      { cwd: process.cwd() }
    );

    expect(stdout).toContain("--target-level-size <n>");
    expect(stdout).toMatch(
      /Continue until a completed level contains at most\s+N photos/
    );
  });

  it("rejects zero instead of silently changing it to one", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        ["src/index.js", "--target-level-size", "0"],
        { cwd: process.cwd() }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("must be a positive integer"),
    });
  });

  it("forwards a valid target into the recursive scheduler", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-cli-target-"));
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "src/index.js",
          "--provider",
          "ollama",
          "--dir",
          dir,
          "--target-level-size",
          "10",
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, OPENAI_API_KEY: "test" },
        }
      );

      expect(stdout).toContain("target-level-size=10");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
