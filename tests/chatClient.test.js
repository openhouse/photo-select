import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as config from "../src/config.js";

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

let parseReply,
  buildMessages,
  buildInput,
  chatCompletion,
  curatorsFromTags,
  cacheKey,
  buildGPT5Schema,
  schemaForBatch,
  useResponses;
beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
  ({
    parseReply,
    buildMessages,
    buildInput,
    chatCompletion,
    curatorsFromTags,
    cacheKey,
    buildGPT5Schema,
    schemaForBatch,
    useResponses,
  } = await import('../src/chatClient.js'));
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
      minutes: [],
      decision: {
        keep: { "DSCF1234.jpg": "good light" },
        aside: { "DSCF5678.jpg": "out of focus" },
      },
    });
    const { keep, aside, notes } = parseReply(json, files);
    expect(keep).toContain(files[0]);
    expect(notes.get(files[0])).toMatch(/good light/);
    expect(aside).toContain(files[1]);
    expect(notes.get(files[1])).toMatch(/out of focus/);
    expect(aside).not.toContain(files[2]);
  });

  it("parses strict decisions array", () => {
    const json = JSON.stringify({
      minutes: [{ speaker: "Jamie", text: "ok" }],
      decisions: [
        { filename: "DSCF1234.jpg", decision: "keep", reason: "good light" },
        { filename: "DSCF5678.jpg", decision: "aside", reason: "blurry" }
      ]
    });
    const { keep, aside, notes, minutes } = parseReply(json, files);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
    expect(notes.get(files[0])).toMatch(/good light/);
    expect(notes.get(files[1])).toMatch(/blurry/);
    expect(minutes[0]).toMatch(/Jamie/);
  });

  it('parses DECISIONS_JSON block', () => {
    const txt =
      'MINUTES\n• Curator-A: hello?\n=== DECISIONS_JSON ===\n{"decisions":[{"filename":"DSCF1234.jpg","decision":"keep","reason":"good"}]}\n=== END ===';
    const { keep } = parseReply(txt, files);
    expect(keep).toContain(files[0]);
  });

  it('salvages decisions from minutes lines', () => {
    const txt = 'KEEP DSCF1234.jpg — anchor\nASIDE DSCF5678.jpg — blur';
    const { keep, aside } = parseReply(txt, files);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
  });

  it("parses mixed object and string entries", () => {
    const json = JSON.stringify({
      keep: [
        "DSCF1234.jpg",
        { file: "DSCF5678.jpg", reason: "great action" },
      ],
      aside: [
        { file: "DSCF9012.jpg", reason: "blurry" },
      ],
      unclassified: [],
      notes: [],
      minutes: [],
    });
    const { keep, aside, notes } = parseReply(json, files);
    expect(keep).toContain(files[0]);
    expect(keep).toContain(files[1]);
    expect(notes.get(files[1])).toMatch(/great action/);
    expect(aside).toContain(files[2]);
    expect(notes.get(files[2])).toMatch(/blurry/);
  });

  it("handles JSON wrapped in Markdown fences", () => {
    const fenced =
      '```json\n' +
      JSON.stringify({
        keep: [{ file: "DSCF1234.jpg" }],
        aside: [{ file: "DSCF5678.jpg" }],
        unclassified: [],
        notes: [],
        minutes: [],
      }) +
      '\n```';
    const { keep, aside } = parseReply(fenced, files);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
  });

  it("deduplicates files listed in both groups", () => {
    const reply = JSON.stringify({
      keep: [{ file: "DSCF1234.jpg" }],
      aside: [{ file: "DSCF1234.jpg" }],
      unclassified: [],
      notes: [],
      minutes: [],
    });
    const { keep, aside } = parseReply(reply, files);
    expect(keep).toContain(files[0]);
    expect(aside).not.toContain(files[0]);
  });

  it("parses minutes and nested decision", () => {
    const reply = JSON.stringify({
      minutes: [{ speaker: "Jamie", text: "looks good" }],
      decision: {
        keep: { "DSCF1234.jpg": "" },
        aside: { "DSCF5678.jpg": "" },
      },
    });
    const { keep, aside, minutes } = parseReply(reply, files);
    expect(minutes[0]).toMatch(/Jamie/);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
  });

  it("extracts field note instructions", () => {
    const obj = {
      decision: { keep: [], aside: [] },
      field_notes_instructions: "Add note",
    };
    const { fieldNotesInstructions } = parseReply(JSON.stringify(obj), files, {
      expectFieldNotesInstructions: true,
    });
    expect(fieldNotesInstructions).toBe("Add note");
  });

  it("extracts field notes markdown", () => {
    const obj = { field_notes_md: "notes" };
    const { fieldNotesMd } = parseReply(JSON.stringify(obj), files, {
      expectFieldNotesMd: true,
    });
    expect(fieldNotesMd).toBe("notes");
  });

  it("extracts commit message", () => {
    const obj = { field_notes_md: "notes", commit_message: "Add note" };
    const { commitMessage } = parseReply(JSON.stringify(obj), files, {
      expectFieldNotesMd: true,
    });
    expect(commitMessage).toBe("Add note");
  });

  it("writes failed replies to the debug directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ps-fail-"));
    process.env.PHOTO_SELECT_DEBUG_DIR = tmp;
    parseReply("", files, {
      model: "gpt-5",
      verbosity: "high",
      reasoningEffort: "high",
    });
    const debugPath = path.join(tmp, ".debug");
    const entries = await fs.readdir(debugPath);
    expect(entries.some((e) => e.startsWith("failed-reply-"))).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.PHOTO_SELECT_DEBUG_DIR;
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
    chatSpy.mockClear();
    responsesSpy.mockResolvedValueOnce({ output_text: "ok" });
    const result = await chatCompletion({
      prompt: "p",
      images: [],
      model: "gpt-5-mini",
      cache: false,
    });
    expect(responsesSpy).toHaveBeenCalled();
    expect(chatSpy).not.toHaveBeenCalled();
    const args = responsesSpy.mock.calls[0][0];
    expect(args.text.verbosity).toBe("low");
    expect(args.reasoning.effort).toBe("minimal");
    expect(args.text.format.type).toBe("json_schema");
    expect(args.text.format.name).toBe("photo_select_decision");
    expect(args.text.format.strict).toBe(true);
    expect(
      args.text.format.schema.properties.minutes.items.properties.speaker.type).toBe("string");
    expect(result).toBe("ok");
  });

  it("extracts JSON from output_json when output_text is empty", async () => {
    responsesSpy.mockClear();
    const payload = {
      output_text: "",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_json",
              json: {
                keep: [{ file: "DSCF1234.jpg", reason: "sharp" }],
                aside: [{ file: "DSCF5678.jpg", reason: "blurry" }],
                unclassified: [],
                notes: [],
                minutes: [],
              },
            },
          ],
        },
      ],
    };
    responsesSpy.mockResolvedValueOnce(payload);
    const reply = await chatCompletion({
      prompt: "p",
      images: [],
      model: "gpt-5",
      cache: false,
    });
    const testFiles = ["/tmp/DSCF1234.jpg", "/tmp/DSCF5678.jpg"];
    const { keep, aside } = parseReply(reply, testFiles);
    expect(keep).toContain(testFiles[0]);
    expect(aside).toContain(testFiles[1]);
    await fs.rm('.debug', { recursive: true, force: true });
  });

  it("allows overriding verbosity and reasoning effort", async () => {
    responsesSpy.mockClear();
    responsesSpy.mockResolvedValueOnce({ output_text: "ok" });
    await chatCompletion({
      prompt: "p",
      images: [],
      model: "gpt-5",
      cache: false,
      verbosity: "high",
      reasoningEffort: "high",
    });
    const args = responsesSpy.mock.calls[0][0];
    expect(args.text.verbosity).toBe("high");
    expect(args.reasoning.effort).toBe("high");
  });

  it("rejects invalid flags", async () => {
    await expect(
      chatCompletion({
        prompt: "p",
        images: [],
        model: "gpt-5",
        cache: false,
        verbosity: "loud",
      })
    ).rejects.toThrow(/verbosity/);
    await expect(
      chatCompletion({
        prompt: "p",
        images: [],
        model: "gpt-5",
        cache: false,
        reasoningEffort: "extreme",
      })
    ).rejects.toThrow(/reasoningEffort/);
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

describe("cacheKey", () => {
  it("changes when verbosity differs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-cache-"));
    const img = path.join(dir, "a.jpg");
    await fs.writeFile(img, "a");
    const k1 = await cacheKey({ prompt: "p", images: [img], model: "gpt-5", verbosity: "low" });
    const k2 = await cacheKey({ prompt: "p", images: [img], model: "gpt-5", verbosity: "high" });
    expect(k1).not.toBe(k2);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("changes when reasoning effort differs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ps-cache-"));
    const img = path.join(dir, "a.jpg");
    await fs.writeFile(img, "a");
    const k1 = await cacheKey({ prompt: "p", images: [img], model: "gpt-5", reasoningEffort: "minimal" });
    const k2 = await cacheKey({ prompt: "p", images: [img], model: "gpt-5", reasoningEffort: "high" });
    expect(k1).not.toBe(k2);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("buildGPT5Schema", () => {
  it("enumerates files", () => {
    const schema = buildGPT5Schema({
      files: ["a.jpg", "b.jpg"],
    });
    const item = schema.schema.properties.decisions.items;
    expect(item.properties.filename.enum).toEqual(["a.jpg", "b.jpg"]);
    expect(item.properties.decision.enum).toEqual(["keep", "aside"]);
    expect(item.required).toEqual(["filename", "decision", "reason"]);
    expect(schema.schema.properties.minutes.items.properties.speaker.type).toBe("string");
  });

  it("provides batch helper", () => {
    const used = ["/tmp/a.jpg", "/tmp/b.jpg"];
    const schema = schemaForBatch(used, ["Curator-1"]);
    const item = schema.schema.properties.decisions.items;
    expect(item.properties.filename.enum).toEqual(["a.jpg", "b.jpg"]);
  });

  it('respects minutes bounds', () => {
    const schema = buildGPT5Schema({ files: ['a.jpg'], minutesMin: 5, minutesMax: 7 });
    const mins = schema.schema.properties.minutes;
    expect(mins.minItems).toBe(5);
    expect(mins.maxItems).toBe(7);
  });
});

describe("useResponses", () => {
  it("detects gpt-5 models", () => {
    expect(useResponses("gpt-5-mini")).toBe(true);
    expect(useResponses("gpt-4o")).toBe(false);
  });
});

describe("cache guards", () => {
  beforeEach(async () => {
    await fs.rm('.cache', { recursive: true, force: true });
    responsesSpy.mockReset();
  });

  it("skips caching zero-decision replies", async () => {
    responsesSpy.mockResolvedValueOnce({
      output_text: JSON.stringify({ minutes: [], decisions: [] }),
    });
    await chatCompletion({
      prompt: "p",
      images: [],
      model: "gpt-5",
      cache: true,
    });
    const files = await fs.readdir('.cache').catch(() => []);
    expect(files.length).toBe(0);
  });

  it("evicts zero-decision cache entries", async () => {
    const key = await cacheKey({ prompt: "p", images: [], model: "gpt-5" });
    await fs.mkdir('.cache', { recursive: true });
    await fs.writeFile(
      path.join('.cache', `${key}.txt`),
      JSON.stringify({ minutes: [], decisions: [] }),
      'utf8'
    );
    responsesSpy.mockResolvedValueOnce({ output_text: 'fresh' });
    const out = await chatCompletion({
      prompt: 'p',
      images: [],
      model: 'gpt-5',
      cache: true,
    });
    expect(out).toBe('fresh');
    expect(responsesSpy).toHaveBeenCalledTimes(1);
  });
});

describe('retry policy', () => {
  it('backs off with jitter on transient errors', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const delaySpy = vi.spyOn(config, 'delay').mockResolvedValue();
    responsesSpy
      .mockRejectedValueOnce({ status: 502, headers: {} })
      .mockResolvedValueOnce({ output_text: JSON.stringify({ minutes: [], decisions: [] }) });
    await chatCompletion({ prompt: 'p', images: [], model: 'gpt-5', cache: false });
    expect(delaySpy).toHaveBeenCalled();
    const wait = delaySpy.mock.calls[0][0];
    expect(wait).toBeGreaterThanOrEqual(1000);
    expect(wait).toBeLessThanOrEqual(30000);
    Math.random.mockRestore();
    delaySpy.mockRestore();
  });
});
