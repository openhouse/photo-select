import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("--refresh-people-index", () => {
  it("advertises an explicit derived-metadata refresh without changing defaults", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["src/index.js", "--help"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("--refresh-people-index");
    expect(stdout).toMatch(/force one verified rebuild[\s\S]*people index/i);
  });
});
