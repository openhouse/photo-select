import { describe, it, expect } from "vitest";
import { buildPrompt, DEFAULT_PROMPT_PATH } from "../src/templates.js";

const images = ["a.jpg", "b.jpg", "c.jpg"];
const curators = ["Curator-A", "Curator-B"];

describe("buildPrompt", () => {
  it("includes role-play phrase and minutes range", async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(
      DEFAULT_PROMPT_PATH,
      { curators, images }
    );
    expect(
      prompt
    ).toMatch(
      new RegExp(
        `role play as ${curators.join(", ")}:\\n - inidicate who is speaking\\n - say what you think`
      )
    );
    expect(prompt).toContain(
      `MINUTES (${minutesMin}\u2013${minutesMax} bullet lines)`
    );
  });
});
