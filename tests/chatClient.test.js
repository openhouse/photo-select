import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let chatSpy;
let responsesSpy;

class MockNotFoundError extends Error {
  constructor(msg) {
    super(msg);
    this.status = 404;
  }
}

vi.mock("openai", () => {
  chatSpy = vi.fn();
  responsesSpy = vi.fn();
  return {
    OpenAI: vi.fn(() => ({
      chat: { completions: { create: chatSpy } },
      responses: { create: responsesSpy },
    })),
    NotFoundError: MockNotFoundError,
  };
});

let parseReply, buildMessages, buildInput, chatCompletion, curatorsFromTags;
beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
  ({ parseReply, buildMessages, buildInput, chatCompletion, curatorsFromTags } = await import('../src/chatClient.js'));
});

afterAll(() => {
  global.fetch = undefined;
});

const files = [
  "/tmp/DSCF1234.jpg",
  "/tmp/DSCF5678.jpg",
  "/tmp/DSCF9012.jpg",
];

/** Basic parsing of keep/aside directives */
describe("parseReply", () => {
  it("classifies mentioned files and captures notes", () => {
    const reply = `DSCF1234.jpg -- keep - sharp shot\nSet aside: DSCF5678.jpg - blurry`;
    const { keep, aside, notes } = parseReply(reply, files);
    expect(keep).toContain(files[0]);
    expect(notes.get(files[0])).toMatch(/sharp/);
    expect(aside).toContain(files[1]);
    expect(notes.get(files[1])).toMatch(/blurry/);
  });

  it("leaves unmentioned files unclassified", () => {
    const reply = `keep: DSCF1234.jpg`;
    const { aside, keep, unclassified } = parseReply(reply, files);
    expect(keep).toContain(files[0]);
    expect(unclassified).toContain(files[1]);
    expect(unclassified).toContain(files[2]);
  });

  it("matches filenames when the reply omits prefixes", () => {
    const prefixed = [
      "/tmp/2020-01-01-DSCF1234.jpg",
      "/tmp/2020-01-01-DSCF5678.jpg",
    ];
    const reply = `DSCF1234.jpg -- keep\nSet aside: DSCF5678.jpg`;
    const { keep, aside } = parseReply(reply, prefixed);
    expect(keep).toContain(prefixed[0]);
    expect(aside).toContain(prefixed[1]);
  });

  it("parses JSON responses with reasoning", () => {
    const json = JSON.stringify({
      keep: { "DSCF1234.jpg": "good light" },
      aside: { "DSCF5678.jpg": "out of focus" },
    });
    const { keep, aside, notes } = parseReply(json, files);
    expect(keep).toContain(files[0]);
    expect(notes.get(files[0])).toMatch(/good light/);
    expect(aside).toContain(files[1]);
    expect(notes.get(files[1])).toMatch(/out of focus/);
    expect(aside).not.toContain(files[2]);
  });

  it("handles JSON wrapped in Markdown fences", () => {
    const fenced =
      '```json\n' +
      JSON.stringify({ keep: ["DSCF1234.jpg"], aside: ["DSCF5678.jpg"] }) +
      '\n```';
    const { keep, aside } = parseReply(fenced, files);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
  });

  it("deduplicates files listed in both groups", () => {
    const reply = JSON.stringify({ keep: ["DSCF1234.jpg"], aside: ["DSCF1234.jpg"] });
    const { keep, aside } = parseReply(reply, files);
    expect(keep).toContain(files[0]);
    expect(aside).not.toContain(files[0]);
  });

  it("parses minutes and nested decision", () => {
    const reply = JSON.stringify({
      minutes: [{ speaker: "Curator", text: "looks good" }],
      decision: { keep: ["DSCF1234.jpg"], aside: ["DSCF5678.jpg"] },
    });
    const { keep, aside, minutes } = parseReply(reply, files);
    expect(minutes[0]).toMatch(/Curator/);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
  });
});

/** Verify images are labelled in messages */
describe("buildMessages", () => {
  it("labels each image before the encoded data", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-msg-"));
    const img1 = path.join(dir, "1.jpg");
    const img2 = path.join(dir, "2.jpg");
    await fs.writeFile(img1, "a");
    await fs.writeFile(img2, "b");
    const { messages } = await buildMessages("prompt", [img1, img2]);
    const [, user] = messages;
    expect(JSON.parse(user.content[1].text)).toEqual({ filename: "1.jpg" });
    expect(JSON.parse(user.content[3].text)).toEqual({ filename: "2.jpg" });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("includes people names when available", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-msg-"));
    const img1 = path.join(dir, "a.jpg");
    await fs.writeFile(img1, "a");
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: ["Alice", "Bob"] }),
    });
    const { messages } = await buildMessages("prompt", [img1]);
    const [, user] = messages;
    const meta = JSON.parse(user.content[1].text);
    expect(meta.filename).toBe("a.jpg");
    expect(meta.people).toEqual(["Alice", "Bob"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("buildInput", () => {
  it("labels each image before the encoded data", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-in-"));
    const img1 = path.join(dir, "1.jpg");
    await fs.writeFile(img1, "a");
    const { input } = await buildInput("prompt", [img1]);
    const meta = JSON.parse(input[0].content[1].text);
    expect(meta).toEqual({ filename: "1.jpg" });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("includes people names when available", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-in-"));
    const img1 = path.join(dir, "a.jpg");
    await fs.writeFile(img1, "a");
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: ["Alice", "Bob"] }),
    });
    const { input } = await buildInput("prompt", [img1]);
    const meta = JSON.parse(input[0].content[1].text);
    expect(meta.filename).toBe("a.jpg");
    expect(meta.people).toEqual(["Alice", "Bob"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("curatorsFromTags", () => {
  it("returns names appearing in multiple files", async () => {
    const imgs = ["/tmp/x1.jpg", "/tmp/x2.jpg", "/tmp/x3.jpg"];
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["Alice"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["Bob"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["Alice"] }) });
    const names = await curatorsFromTags(imgs);
    expect(names).toContain("Alice");
  });

  it("filters placeholder names", async () => {
    const imgs = ["/tmp/y1.jpg", "/tmp/y2.jpg"];
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["_UNKNOWN_"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["_UNKNOWN_"] }) });
    const names = await curatorsFromTags(imgs);
    expect(names).toHaveLength(0);
    global.fetch.mockReset();
  });
});

describe("chatCompletion", () => {
  let chatCompletion;

  beforeAll(async () => {
    ({ chatCompletion } = await import("../src/chatClient.js"));
  });

  it("falls back to responses when chat endpoint not supported", async () => {
    const errMsg =
      "This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?";
    chatSpy.mockRejectedValueOnce(new MockNotFoundError(errMsg));
    responsesSpy.mockResolvedValueOnce({ output_text: "ok" });
    const result = await chatCompletion({
      prompt: "p",
      images: [],
      model: "o3-pro",
      cache: false,
    });
    expect(responsesSpy).toHaveBeenCalled();
    const args = responsesSpy.mock.calls[0][0];
    expect(args.max_output_tokens).toBeTruthy();
    expect(result).toBe("ok");
  });

  it("uses responses API with verbosity and reasoning for gpt-5 models", async () => {
    responsesSpy.mockClear();
    responsesSpy.mockResolvedValueOnce({ output_text: "ok" });
    const result = await chatCompletion({
      prompt: "p",
      images: [],
      model: "gpt-5-mini",
      cache: false,
    });
    expect(responsesSpy).toHaveBeenCalled();
    const args = responsesSpy.mock.calls[0][0];
    expect(args.text.verbosity).toBe("high");
    expect(args.reasoning.effort).toBe("high");
    expect(result).toBe("ok");
  });

  it("allows overriding verbosity and reasoning effort", async () => {
    responsesSpy.mockClear();
    responsesSpy.mockResolvedValueOnce({ output_text: "ok" });
    await chatCompletion({
      prompt: "p",
      images: [],
      model: "gpt-5",
      cache: false,
      verbosity: "low",
      reasoningEffort: "minimal",
    });
    const args = responsesSpy.mock.calls[0][0];
    expect(args.text.verbosity).toBe("low");
    expect(args.reasoning.effort).toBe("minimal");
  });

  it("logs additional curators from tags", async () => {
    vi.resetModules();
    const { chatCompletion } = await import("../src/chatClient.js");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-cur-"));
    const img1 = path.join(dir, "1.jpg");
    const img2 = path.join(dir, "2.jpg");
    await fs.writeFile(img1, "a");
    await fs.writeFile(img2, "b");
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["Alice"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["Alice"] }) });
    chatSpy.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await chatCompletion({
      prompt: "p {{curators}}",
      images: [img1, img2],
      model: "gpt-4o",
      cache: false,
      curators: ["Bob"],
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Alice")
    );
    logSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
