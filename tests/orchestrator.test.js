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

import { chatCompletion, getPeople } from "../src/chatClient.js";
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
    await expect(fs.stat(path.join(tmpDir, "1.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "2.jpg"))).resolves.toBeTruthy();
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

  it("recurses even when all images kept", async () => {
    chatCompletion
      .mockResolvedValueOnce(
        JSON.stringify({ keep: ["1.jpg", "2.jpg"], aside: [] })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ keep: [], aside: ["1.jpg", "2.jpg"] })
      );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: true,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const aside2 = path.join(tmpDir, "_keep", "_aside", "2.jpg");
    await expect(fs.stat(aside2)).resolves.toBeTruthy();
  });

  it("resumes into deepest _keep when parent has no images", async () => {
    await fs.rm(path.join(tmpDir, "1.jpg"));
    await fs.rm(path.join(tmpDir, "2.jpg"));
    const deep = path.join(tmpDir, "_keep", "_keep");
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "1.jpg"), "a");
    await fs.writeFile(path.join(deep, "2.jpg"), "b");

    chatCompletion
      .mockResolvedValueOnce(
        JSON.stringify({ keep: ["1.jpg"], aside: ["2.jpg"] })
      )
      .mockResolvedValue(
        JSON.stringify({ keep: [], aside: ["1.jpg"] })
      );

    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: true,
    });

    await expect(
      fs.stat(path.join(deep, "_keep", "_aside", "1.jpg"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(deep, "_aside", "2.jpg"))
    ).resolves.toBeTruthy();

    chatCompletion.mockReset();
  });

  it("processes batches in parallel", async () => {
    chatCompletion
      .mockResolvedValueOnce(JSON.stringify({ keep: ["1.jpg"], aside: [] }))
      .mockResolvedValueOnce(JSON.stringify({ keep: [], aside: ["2.jpg"] }));
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      parallel: 2,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const keepPath = path.join(tmpDir, "_keep", "1.jpg");
    const asidePath = path.join(tmpDir, "_aside", "2.jpg");
    await expect(fs.stat(keepPath)).resolves.toBeTruthy();
    await expect(fs.stat(asidePath)).resolves.toBeTruthy();
  });

  it("processes batches with workers", async () => {
    chatCompletion
      .mockResolvedValueOnce(JSON.stringify({ keep: ["1.jpg"], aside: [] }))
      .mockResolvedValueOnce(JSON.stringify({ keep: [], aside: ["2.jpg"] }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      workers: 2,
    });
    const etaLogs = logSpy.mock.calls.filter(([m]) =>
      m.includes("ETA to finish level")
    );
    expect(etaLogs.length).toBeGreaterThanOrEqual(2);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const keepPath = path.join(tmpDir, "_keep", "1.jpg");
    const asidePath = path.join(tmpDir, "_aside", "2.jpg");
    await expect(fs.stat(keepPath)).resolves.toBeTruthy();
    await expect(fs.stat(asidePath)).resolves.toBeTruthy();
  });

  it("requeues unclassified images with workers", async () => {
    await fs.writeFile(path.join(tmpDir, "3.jpg"), "c");
    chatCompletion
      .mockResolvedValueOnce(JSON.stringify({ keep: ["1.jpg"], aside: [] }))
      .mockResolvedValueOnce(
        JSON.stringify({ keep: [], aside: ["2.jpg", "3.jpg"] })
      );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      workers: 2,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    await expect(
      fs.stat(path.join(tmpDir, "_keep", "1.jpg"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tmpDir, "_aside", "2.jpg"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tmpDir, "_aside", "3.jpg"))
    ).resolves.toBeTruthy();
  });

  it("retries after chat errors", async () => {
    chatCompletion
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(JSON.stringify({ keep: ["1.jpg"], aside: ["2.jpg"] }));
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const keepPath = path.join(tmpDir, "_keep", "1.jpg");
    const asidePath = path.join(tmpDir, "_aside", "2.jpg");
    await expect(fs.stat(keepPath)).resolves.toBeTruthy();
    await expect(fs.stat(asidePath)).resolves.toBeTruthy();
  });

  it("saves prompts and responses when enabled", async () => {
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({ keep: ["1.jpg"], aside: ["2.jpg"] })
    );
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      saveIo: true,
    });
    const levelDir = path.join(tmpDir, "_level-001");
    const prompts = await fs.readdir(path.join(levelDir, "_prompts"));
    const responses = await fs.readdir(path.join(levelDir, "_responses"));
    expect(prompts.length).toBe(1);
    expect(responses.length).toBe(1);
    const promptTxt = await fs.readFile(
      path.join(levelDir, "_prompts", prompts[0]),
      "utf8"
    );
    expect(promptTxt).toContain("prompt");
    const respTxt = await fs.readFile(
      path.join(levelDir, "_responses", responses[0]),
      "utf8"
    );
    expect(respTxt).toContain("1.jpg");
  });

  it("includes additional curators from tags in saved prompt", async () => {
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({ keep: ["1.jpg"], aside: ["2.jpg"] })
    );
    getPeople
      .mockResolvedValueOnce(["Alice", "Bob"])
      .mockResolvedValueOnce(["Alice"]);
    await fs.writeFile(promptFile, "Curators: {{curators}}");
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: "test-model",
      recurse: false,
      saveIo: true,
      curators: ["Bob"],
    });
    const levelDir = path.join(tmpDir, "_level-001");
    const prompts = await fs.readdir(path.join(levelDir, "_prompts"));
    const promptTxt = await fs.readFile(
      path.join(levelDir, "_prompts", prompts[0]),
      "utf8"
    );
    expect(promptTxt).toContain("Curators: Bob, Alice");
    expect(chatCompletion.mock.calls[0][0].curators).toEqual([
      "Bob",
      "Alice",
    ]);
  });

  it('repairs zero-decision batch', async () => {
    chatCompletion
      .mockResolvedValueOnce(JSON.stringify({ minutes: [], decisions: [] }))
      .mockResolvedValueOnce(
        '=== DECISIONS_JSON ===\n{"decisions":[{"filename":"1.jpg","decision":"keep","reason":""}]}\n=== END ==='
      );
    await fs.unlink(path.join(tmpDir, '2.jpg'));
    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      model: 'test-model',
      recurse: false,
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const secondCall = chatCompletion.mock.calls[1][0];
    expect(secondCall.prompt).toMatch(/Return only the block below/);
    expect(secondCall.prompt).toMatch(/role play as/);
    expect(secondCall.verbosity).toBe('low');
    expect(secondCall.minutesMin).toBe(0);
    expect(secondCall.minutesMax).toBe(0);
    await expect(fs.stat(path.join(tmpDir, '_keep', '1.jpg'))).resolves.toBeTruthy();
  });

  it("stops processing when billing limit is reached", async () => {
    const provider = {
      submit: vi.fn(async () => ({})),
      collect: vi.fn(async () => {
        const err = new Error("Billing hard limit has been reached");
        err.response = {
          data: { error: { message: "Billing hard limit has been reached" } },
        };
        throw err;
      }),
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        triageDirectory({
          dir: tmpDir,
          promptPath: promptFile,
          model: "test-model",
          recurse: false,
          provider,
        })
      ).rejects.toMatchObject({ code: "BILLING_LIMIT" });
    } finally {
      logSpy.mockRestore();
    }
    expect(provider.submit).toHaveBeenCalledTimes(1);
    await expect(fs.stat(path.join(tmpDir, "1.jpg"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, "2.jpg"))).resolves.toBeTruthy();
  });

});
