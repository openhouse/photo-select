import { describe, expect, it } from "vitest";
import { planNeedsReviewRetry } from "../src/core/planNeedsReviewRetry.js";

describe("planNeedsReviewRetry", () => {
  it("offers the next repair pass while the per-level budget remains", () => {
    expect(
      planNeedsReviewRetry({
        enabled: true,
        retriesUsed: 1,
        maxRetries: 2,
        heldCount: 10,
      })
    ).toEqual({
      shouldRetry: true,
      retriesUsed: 2,
      attempt: 2,
      reason: "available",
    });
  });

  it("fails closed after the configured repair budget is exhausted", () => {
    expect(
      planNeedsReviewRetry({
        enabled: true,
        retriesUsed: 2,
        maxRetries: 2,
        heldCount: 10,
      })
    ).toEqual({
      shouldRetry: false,
      retriesUsed: 2,
      reason: "exhausted",
    });
  });

  it("does not alter the default hold behavior when repair is disabled", () => {
    expect(
      planNeedsReviewRetry({
        enabled: false,
        retriesUsed: 0,
        maxRetries: 2,
        heldCount: 10,
      }).shouldRetry
    ).toBe(false);
  });
});
