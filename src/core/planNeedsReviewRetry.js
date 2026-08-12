/**
 * Decide whether a level may begin another automatic NEEDS_REVIEW repair pass.
 * The caller persists the returned retry count before submitting any work.
 */
export function planNeedsReviewRetry({
  enabled,
  retriesUsed,
  maxRetries,
  heldCount,
}) {
  if (!enabled || heldCount === 0) {
    return { shouldRetry: false, retriesUsed, reason: "not_requested" };
  }
  if (retriesUsed >= maxRetries) {
    return { shouldRetry: false, retriesUsed, reason: "exhausted" };
  }
  return {
    shouldRetry: true,
    retriesUsed: retriesUsed + 1,
    attempt: retriesUsed + 1,
    reason: "available",
  };
}
