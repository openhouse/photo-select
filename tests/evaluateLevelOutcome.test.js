import { describe, expect, it } from "vitest";
import { evaluateLevelOutcome } from "../src/core/evaluateLevelOutcome.js";

describe("evaluateLevelOutcome", () => {
  it.each([
    {
      name: "stops after unanimous keep",
      input: { complete: true, hasKeep: true, hasAside: false },
      expected: { state: "unanimous_keep", shouldStop: true },
    },
    {
      name: "stops after unanimous aside",
      input: { complete: true, hasKeep: false, hasAside: true },
      expected: { state: "unanimous_aside", shouldStop: true },
    },
    {
      name: "continues after a mixed decision",
      input: { complete: true, hasKeep: true, hasAside: true },
      expected: { state: "mixed", shouldStop: false },
    },
    {
      name: "does not stop an incomplete level",
      input: { complete: false, hasKeep: true, hasAside: false },
      expected: { state: "incomplete", shouldStop: false },
    },
    {
      name: "does not call an empty directory unanimous",
      input: { complete: true, hasKeep: false, hasAside: false },
      expected: { state: "empty", shouldStop: false },
    },
  ])("$name", ({ input, expected }) => {
    expect(evaluateLevelOutcome(input)).toEqual(expected);
  });

  it.each([
    {
      name: "at the requested size",
      levelSize: 10,
    },
    {
      name: "below the requested size",
      levelSize: 9,
    },
  ])("stops a completed mixed level $name", ({ levelSize }) => {
    expect(
      evaluateLevelOutcome({
        complete: true,
        hasKeep: true,
        hasAside: true,
        levelSize,
        targetLevelSize: 10,
      })
    ).toEqual({ state: "target_reached", shouldStop: true });
  });

  it("continues past unanimous keep while the completed level is above the target", () => {
    expect(
      evaluateLevelOutcome({
        complete: true,
        hasKeep: true,
        hasAside: false,
        levelSize: 11,
        targetLevelSize: 10,
      })
    ).toEqual({ state: "unanimous_keep", shouldStop: false });
  });

  it("still stops after unanimous aside above the target because no photos remain", () => {
    expect(
      evaluateLevelOutcome({
        complete: true,
        hasKeep: false,
        hasAside: true,
        levelSize: 11,
        targetLevelSize: 10,
      })
    ).toEqual({ state: "unanimous_aside", shouldStop: true });
  });
});
