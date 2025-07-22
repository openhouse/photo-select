import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import FieldNotesWriter from "../src/fieldNotesWriter.js";

const exec = promisify(execFile);

async function generateDiff(oldStr, newStr) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-"));
  const a = path.join(dir, "a.md");
  const b = path.join(dir, "b.md");
  await fs.writeFile(a, oldStr);
  await fs.writeFile(b, newStr);
  const { stdout } = await exec("diff", ["-u", "--label", "a/field-notes.md", a, "--label", "b/field-notes.md", b]).catch((e) => ({ stdout: e.stdout }));
  await fs.rm(dir, { recursive: true, force: true });
  return stdout;
}

describe("FieldNotesWriter", () => {
  let dir;
  let file;
  let writer;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "fnw-"));
    file = path.join(dir, "field-notes.md");
    await fs.writeFile(path.join(dir, "DSCF1.jpg"), "");
    await fs.writeFile(path.join(dir, "DSCF2.png"), "");
    await fs.writeFile(path.join(dir, "DSCF3.jpg"), "");
    await fs.writeFile(path.join(dir, "DSCF4.jpg"), "");
    writer = new FieldNotesWriter(file, "001");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("autolinks bare filenames", () => {
    const text = writer.autolink("See DSCF1.jpg and DSCF2.png");
    expect(text).toContain("[DSCF1.jpg](./DSCF1.jpg)");
    expect(text).toContain("[DSCF2.png](./DSCF2.png)");
  });

  it("adds warning when too many inline images", async () => {
    const md = "![](./DSCF1.jpg)\n![](./DSCF2.png)\n![](./DSCF3.jpg)\n![](./DSCF4.jpg)";
    await writer.writeFull(md);
    const text = await fs.readFile(file, "utf8");
    expect(text).toMatch(/Warning/);
  });

  it("applies diffs", async () => {
    await writer.writeFull("hello");
    const diff = await generateDiff("hello\n", "hello\nworld\n");
    await writer.applyDiff(diff);
    const result = await writer.read();
    expect(result.trim()).toBe("hello\nworld");
  });

  it("falls back when patch command fails", async () => {
    const failExec = vi.fn().mockRejectedValue(new Error("patch missing"));
    const w = new FieldNotesWriter(file, "001", failExec);
    await w.writeFull("hi");
    const diff = await generateDiff("hi\n", "hi there\n");
    await w.applyDiff(diff);
    const result = await w.read();
    expect(result.trim()).toBe("hi there");
  });

  it("throws when diff cannot apply", async () => {
    const failExec = vi.fn().mockRejectedValue(new Error("patch failed"));
    const w = new FieldNotesWriter(file, "001", failExec);
    await w.writeFull("hello\n");
    const badDiff = "--- a/field-notes.md\n+++ b/field-notes.md\n@@\n-foo\n+bar\n";
    await expect(w.applyDiff(badDiff)).rejects.toThrow();
  });
});
