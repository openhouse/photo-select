const BILLING_ERROR_CODES = new Set([
  "billing_hard_limit_reached",
  "billing_limit",
  "insufficient_quota",
]);

function text(value) {
  return value == null ? "" : String(value);
}

export function providerErrorSummary(err) {
  const nested = err?.error || err?.response?.data?.error || err?.body?.error || {};
  return {
    code: text(nested?.code || err?.code) || undefined,
    type: text(nested?.type || err?.type) || undefined,
    status: Number(err?.status || err?.statusCode || err?.response?.status) || undefined,
    message: text(nested?.message || err?.message) || "Unknown provider error",
  };
}

export function isBillingLimitError(err) {
  if (!err) return false;
  const summary = providerErrorSummary(err);
  if (
    BILLING_ERROR_CODES.has(summary.code?.toLowerCase()) ||
    BILLING_ERROR_CODES.has(summary.type?.toLowerCase())
  ) {
    return true;
  }
  return [
    summary.message,
    err?.error?.message,
    err?.cause?.message,
    err?.response?.data?.error?.message,
    err?.response?.data?.message,
    err?.response?.error?.message,
    err?.response?.message,
    err?.body?.error?.message,
    err?.body?.message,
  ]
    .flat()
    .filter(Boolean)
    .some((message) =>
      /billing (hard )?limit|not have enough credits|add more credits|exceeded (?:your )?(?:current )?quota/i.test(
        String(message)
      )
    );
}

export function createBillingLimitError(err, pause = {}) {
  const wrapped = new Error(
    "OpenAI API credits exhausted; run paused with completed work preserved."
  );
  wrapped.code = "BILLING_LIMIT";
  wrapped.exitCode = 75;
  wrapped.cause = err;
  Object.assign(wrapped, pause);
  return wrapped;
}
