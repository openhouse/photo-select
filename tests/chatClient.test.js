import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const createMock = vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] });

vi.mock("openai", () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}));

let parseReply, chatCompletion;
beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const cacheDir = path.join(os.tmpdir(), 'ps-cache');
  process.env.PHOTOSELECT_CACHE = cacheDir;
  ({ parseReply, chatCompletion } = await import('../src/chatClient.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
});

const files = [
  "/tmp/DSCF1234.jpg",
  "/tmp/DSCF5678.jpg",
  "/tmp/DSCF9012.jpg",
];

/** Basic parsing of keep/aside directives */
describe("parseReply", () => {
  it("classifies mentioned files", () => {
    const reply = `DSCF1234.jpg -- keep\nSet aside: DSCF5678.jpg`;
    const { keep, aside } = parseReply(reply, files);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
  });

  it("defaults unmentioned files to aside", () => {
    const reply = `keep: DSCF1234.jpg`;
    const { aside } = parseReply(reply, files);
    expect(aside).toContain(files[1]);
    expect(aside).toContain(files[2]);
  });
});

describe("chatCompletion caching", () => {
  it("reuses cached response", async () => {
    const tmp = path.join(os.tmpdir(), "img.jpg");
    await fs.writeFile(tmp, "data");
    const params = { prompt: "p", images: [tmp], model: "gpt" };
    const first = await chatCompletion(params);
    const second = await chatCompletion(params);
    expect(second).toBe(first);
    expect(createMock).toHaveBeenCalledTimes(1);
    await fs.unlink(tmp);
  });
});
