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
import { triageDirectory, findResumePoint } from "../src/orchestrator.js";

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
});

describe("findResumePoint", () => {
  it("returns deepest unclassified directory", async () => {
    await fs.mkdir(path.join(tmpDir, "_keep/_keep"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "_keep", "1.jpg"), "a");
    await fs.writeFile(path.join(tmpDir, "_keep/_keep", "2.jpg"), "b");
    // remove top-level files to mimic a resumed state
    await fs.rm(path.join(tmpDir, "1.jpg"));
    await fs.rm(path.join(tmpDir, "2.jpg"));
    const result = await findResumePoint(tmpDir);
    expect(result.dir).toBe(path.join(tmpDir, "_keep/_keep"));
    expect(result.depth).toBe(2);
  });
});
