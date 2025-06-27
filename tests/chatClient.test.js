import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let parseReply, buildMessages;
beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  ({ parseReply, buildMessages } = await import('../src/chatClient.js'));
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
    const [, user] = await buildMessages("prompt", [img1, img2]);
    expect(user.content[1]).toEqual({ type: "text", text: "1.jpg" });
    expect(user.content[3]).toEqual({ type: "text", text: "2.jpg" });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
