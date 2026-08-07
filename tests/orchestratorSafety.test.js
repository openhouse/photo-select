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
  it("recovers a unique trailing-zero timestamp expansion without a restart", async () => {
    const canonicalKeep = "20190219T003218580000Z-community-meeting-01.jpg";
    const expandedKeep = "20190219T003218580000000Z-community-meeting-01.jpg";
    const canonicalAside = "20190219T003219120000Z-community-meeting-02.jpg";
    await fs.rename(path.join(tmpDir, "1.jpg"), path.join(tmpDir, canonicalKeep));
    await fs.rename(path.join(tmpDir, "2.jpg"), path.join(tmpDir, canonicalAside));
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      minutes: [{
        speaker: "Deborah Treisman",
        text: "The first image carries the sequence; what should lead the next pass?",
      }],
      decisions: [
        { filename: expandedKeep, decision: "keep", reason: "sequence anchor" },
        { filename: canonicalAside, decision: "aside", reason: "repeats the beat" },
      ],
    }));

    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      saveIo: true,
    });

    await expect(fs.stat(path.join(tmpDir, "_keep", canonicalKeep))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "_aside", canonicalAside))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "NEEDS_REVIEW"))).rejects.toThrow();
    const minutesName = (await fs.readdir(tmpDir)).find((name) => name.startsWith("minutes-"));
    const minutes = JSON.parse(await fs.readFile(path.join(tmpDir, minutesName), "utf8"));
    expect(minutes.decisions.map(({ filename }) => filename).sort()).toEqual([
      canonicalKeep,
      canonicalAside,
    ].sort());
    expect(JSON.stringify(minutes)).not.toContain(expandedKeep);
    const responseDir = path.join(tmpDir, "_level-001", "_responses");
    const responseName = (await fs.readdir(responseDir))[0];
    const rawResponse = await fs.readFile(path.join(responseDir, responseName), "utf8");
    expect(rawResponse).toContain(expandedKeep);
  });

  it("does not recover a filename whose semantic suffix changed", async () => {
    const canonical = "20190219T003218580000Z-community-meeting-01.jpg";
    const changedSuffix = "20190219T003218580000000Z-community-meeting-02.jpg";
    await fs.rename(path.join(tmpDir, "1.jpg"), path.join(tmpDir, canonical));
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      minutes: [{
        speaker: "Deborah Treisman",
        text: "The returned name changes the subject; what evidence could resolve it?",
      }],
      decisions: [
        { filename: changedSuffix, decision: "keep", reason: "unsafe mismatch" },
        { filename: "2.jpg", decision: "aside", reason: "secondary" },
      ],
    }));

    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
    });

    await expect(fs.stat(path.join(tmpDir, canonical))).resolves.toBeTruthy();
    const marker = await fs.readFile(path.join(tmpDir, "NEEDS_REVIEW"), "utf8");
    expect(marker).toContain("INVALID_DECISIONS");
  });

  it("does not guess when a trailing-zero timestamp expansion is ambiguous", async () => {
    const shorter = "20190219T00321858000Z-community-meeting.jpg";
    const longer = "20190219T003218580000Z-community-meeting.jpg";
    const expanded = "20190219T0032185800000Z-community-meeting.jpg";
    await fs.rename(path.join(tmpDir, "1.jpg"), path.join(tmpDir, shorter));
    await fs.rename(path.join(tmpDir, "2.jpg"), path.join(tmpDir, longer));
    chatCompletion.mockResolvedValueOnce(JSON.stringify({
      minutes: [{
        speaker: "Deborah Treisman",
        text: "Two originals fit this transcription; which one did the model mean?",
      }],
      decisions: [
        { filename: expanded, decision: "keep", reason: "ambiguous timestamp" },
        { filename: longer, decision: "aside", reason: "explicit second choice" },
      ],
    }));

    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
    });

    await expect(fs.stat(path.join(tmpDir, shorter))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, longer))).resolves.toBeTruthy();
    const marker = await fs.readFile(path.join(tmpDir, "NEEDS_REVIEW"), "utf8");
    expect(marker).toContain("INVALID_DECISIONS");
  });

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
