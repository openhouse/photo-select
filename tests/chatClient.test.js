import { describe, it, expect, beforeAll } from "vitest";

let parseReply;
beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  ({ parseReply } = await import('../src/chatClient.js'));
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

  it("parses JSON responses with exact filenames", () => {
    const json = JSON.stringify({
      keep: ["DSCF1234.jpg"],
      aside: ["DSCF5678.jpg"],
    });
    const { keep, aside } = parseReply(json, files);
    expect(keep).toContain(files[0]);
    expect(aside).toContain(files[1]);
    expect(aside).toContain(files[2]);
  });
});
