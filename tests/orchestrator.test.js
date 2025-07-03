import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.hoisted(() => {
  process.env.OPENAI_API_KEY = "test";
});

vi.mock("../src/chatClient.js", async () => {
  const actual = await vi.importActual("../src/chatClient.js");
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

import { chatCompletion } from "../src/chatClient.js";
import { triageDirectory } from "../src/orchestrator.js";

let tmpDir;
let promptFile;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-test-"));
  await fs.writeFile(path.join(tmpDir, "1.jpg"), "a");
  await fs.writeFile(path.join(tmpDir, "2.jpg"), "b");
  promptFile = path.join(tmpDir, "prompt.txt");
  await fs.writeFile(promptFile, "prompt");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("triageDirectory", () => {
  it("moves files into keep and aside", async () => {
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({ keep: ["1.jpg"], aside: ["2.jpg"] })
    );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
    });
    const keepPath = path.join(tmpDir, "_keep", "1.jpg");
    const asidePath = path.join(tmpDir, "_aside", "2.jpg");
    await expect(fs.stat(keepPath)).resolves.toBeTruthy();
    await expect(fs.stat(asidePath)).resolves.toBeTruthy();
    const level = path.join(tmpDir, "_level-001", "1.jpg");
    await expect(fs.stat(level)).resolves.toBeTruthy();
  });

  it("recurses into keep directory", async () => {
    chatCompletion
      .mockResolvedValueOnce(JSON.stringify({ keep: ["1.jpg"], aside: ["2.jpg"] }))
      .mockResolvedValueOnce(JSON.stringify({ keep: [], aside: ["1.jpg"] }));
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: true,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const aside2 = path.join(tmpDir, "_keep", "_aside", "1.jpg");
    await expect(fs.stat(aside2)).resolves.toBeTruthy();
    const level2 = path.join(tmpDir, "_keep", "_level-002", "1.jpg");
    await expect(fs.stat(level2)).resolves.toBeTruthy();
  });

  it("stops recursion when all images kept", async () => {
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({ keep: ["1.jpg", "2.jpg"], aside: [] })
    );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: true,
    });
    // only initial call should happen
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const nested = path.join(tmpDir, "_keep", "_keep");
    await expect(fs.stat(nested)).rejects.toThrow();
  });

  it("updates field notes when diff provided", async () => {
    const diff = "--- a/field-notes.md\n+++ b/field-notes.md\n@@\n+new";
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({ keep: [], aside: ["1.jpg", "2.jpg"], field_notes_diff: diff })
    );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      fieldNotes: true,
    });
    const notesPath = path.join(tmpDir, "_level-001", "field-notes.md");
    const content = await fs.readFile(notesPath, "utf8");
    expect(content).toMatch(/new/);
  });

  it("handles diffs missing headers", async () => {
    const diff = "+foo\n+bar";
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({ keep: [], aside: ["1.jpg", "2.jpg"], field_notes_diff: diff })
    );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      fieldNotes: true,
    });
    const notesPath = path.join(tmpDir, "_level-001", "field-notes.md");
    const content = await fs.readFile(notesPath, "utf8");
    expect(content).toMatch(/foo/);
    expect(content).toMatch(/bar/);
  });

  it("updates field notes via second call when observations provided", async () => {
    chatCompletion
      .mockResolvedValueOnce(
        JSON.stringify({ keep: [], aside: ["1.jpg", "2.jpg"], observations: ["obs1"] })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ field_notes_diff: "--- a/field-notes.md\n+++ b/field-notes.md\n@@\n+obs1" })
      );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      fieldNotes: true,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const notesPath = path.join(tmpDir, "_level-001", "field-notes.md");
    const content = await fs.readFile(notesPath, "utf8");
    expect(content).toMatch(/obs1/);
  });

  it("starts a new field notes file at each recursion level", async () => {
    chatCompletion
      .mockResolvedValueOnce(
        JSON.stringify({
          keep: ["1.jpg"],
          aside: ["2.jpg"],
          field_notes_diff: "--- a/field-notes.md\n+++ b/field-notes.md\n@@\n+parent",
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          keep: [],
          aside: ["1.jpg"],
          field_notes_diff: "--- a/field-notes.md\n+++ b/field-notes.md\n@@\n+child",
        })
      );

    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: true,
      fieldNotes: true,
    });

    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const parentPath = path.join(tmpDir, "_level-001", "field-notes.md");
    const childPath = path.join(tmpDir, "_keep", "_level-002", "field-notes.md");
    const parentContent = await fs.readFile(parentPath, "utf8");
    const childContent = await fs.readFile(childPath, "utf8");
    expect(parentContent).toMatch(/parent/);
    expect(parentContent).not.toMatch(/child/);
    expect(childContent).toMatch(/child/);
    expect(childContent).not.toMatch(/parent/);
  });
});
