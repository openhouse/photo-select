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
    getPeople: vi.fn().mockResolvedValue([]),
  };
});

import { chatCompletion } from "../src/chatClient.js";
import { triageDirectory } from "../src/orchestrator.js";

let tmpDir;
let promptFile;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-safety-"));
  await fs.writeFile(path.join(tmpDir, "1.jpg"), "a");
  await fs.writeFile(path.join(tmpDir, "2.jpg"), "b");
  promptFile = path.join(tmpDir, "prompt.txt");
  await fs.writeFile(promptFile, "prompt");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("triageDirectory safety validation", () => {
  it("leaves files unmoved and marks NEEDS_REVIEW for raw provider envelopes", async () => {
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      object: "response",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "reasoning", summary: [] }],
    }));

    await triageDirectory({ dir: tmpDir, promptPath: promptFile, model: "test-model", recurse: false });

    await expect(fs.stat(path.join(tmpDir, "1.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "2.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "_keep", "1.jpg"))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpDir, "_aside", "2.jpg"))).rejects.toThrow();
    const marker = await fs.readFile(path.join(tmpDir, "NEEDS_REVIEW"), "utf8");
    expect(marker).toContain("1.jpg");
    expect(marker).toContain("PROVIDER_ENVELOPE_NOT_DECISIONS");
    const levelFiles = await fs.readdir(tmpDir);
    expect(levelFiles.some((name) => name.startsWith("minutes-"))).toBe(false);
  });

  it("moves valid all-aside strict decisions", async () => {
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      minutes: [{ speaker: "Jamie", text: "All files are explicit asides." }],
      decisions: [
        { filename: "1.jpg", decision: "aside", reason: "weak" },
        { filename: "2.jpg", decision: "aside", reason: "weak" },
      ],
    }));

    await triageDirectory({ dir: tmpDir, promptPath: promptFile, model: "test-model", recurse: false });

    await expect(fs.stat(path.join(tmpDir, "_aside", "1.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "_aside", "2.jpg"))).resolves.toBeTruthy();
  });

  it("moves valid all-keep strict decisions", async () => {
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      minutes: [{ speaker: "Jamie", text: "All files are explicit keeps." }],
      decisions: [
        { filename: "1.jpg", decision: "keep", reason: "strong" },
        { filename: "2.jpg", decision: "keep", reason: "strong" },
      ],
    }));

    await triageDirectory({ dir: tmpDir, promptPath: promptFile, model: "test-model", recurse: false });

    await expect(fs.stat(path.join(tmpDir, "_keep", "1.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "_keep", "2.jpg"))).resolves.toBeTruthy();
  });

  it("does not move files for duplicate decisions", async () => {
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      minutes: [{ speaker: "Jamie", text: "Duplicate should fail closed." }],
      decisions: [
        { filename: "1.jpg", decision: "keep", reason: "first" },
        { filename: "1.jpg", decision: "aside", reason: "duplicate" },
      ],
    }));

    await triageDirectory({ dir: tmpDir, promptPath: promptFile, model: "test-model", recurse: false });

    await expect(fs.stat(path.join(tmpDir, "1.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "2.jpg"))).resolves.toBeTruthy();
    const marker = await fs.readFile(path.join(tmpDir, "NEEDS_REVIEW"), "utf8");
    expect(marker).toContain("INVALID_DECISIONS");
  });
});
