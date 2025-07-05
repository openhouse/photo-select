import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FieldNotesWriter } from "../src/fieldNotes.js";
import { createTwoFilesPatch } from "diff";

let dir;
let file;
let writer;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fn-test-"));
  file = path.join(dir, "field-notes.md");
  writer = new FieldNotesWriter(file);
  await writer.init();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("FieldNotesWriter", () => {
  it("autolinks filenames and stamps", async () => {
    await writer.writeFull("See [a.jpg] and [b.png]");
    const md = await fs.readFile(file, "utf8");
    expect(md).toMatch(/\[a.jpg\]\(\.\/a.jpg\)/);
    expect(md).toMatch(/<!-- created:/);
    expect(md).toMatch(/<!-- updated:/);
  });

  it("applies diff patches", async () => {
    await writer.writeFull("Old\n");
    const diff = createTwoFilesPatch("a", "b", "Old\n", "New\n");
    await writer.applyDiff(diff);
    const md = await fs.readFile(file, "utf8");
    expect(md).toMatch(/New/);
  });
});
