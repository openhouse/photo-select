---
id: photo-select-rfc-0014
title: Xiaomi Batch for ten-image photographic curation
kind: research-inquiry
status: draft
visibility: public-safe
sensitivity: low
last_reviewed: 2026-10-27
canonical_path: docs/rfcs/0014-xiaomi-batch.md
summary: Propose discounted asynchronous MiMo requests with durable reconciliation and unchanged curatorial inputs.
rfc: 0014
stage: proposed
start_date: 2026-10-27
authors: [Jamie Burkart, Codex]
champion: Jamie Burkart
decision_owner: Jamie Burkart
review_areas: [asynchronous transport, cost accounting, source custody, editorial continuity]
implementation: Not implemented; no Xiaomi Batch requests made for this RFC.
supersedes: []
superseded_by: []
relations: [{type: uses_method, target: photo-select-xiaomi-batch, href: ../../wiki/xiaomi-batch.md, context: Durable asynchronous curation method.}, {type: related_to, target: photo-select-rfc-0013, href: 0013-hosted-open-weights.md, context: Preserve the hosted-provider contract.}]
---

# RFC 0014 — Xiaomi Batch for ten-image photographic curation

## Proposal

Add an opt-in `xiaomi-batch` provider for `mimo-v2.6-pro`. Submit independent
ten-image curation requests through Xiaomi's discounted asynchronous Batch API.
Preserve the ordinary prompt, exact curator names, context, People metadata,
reply contract, archives, sorting, and recursive stopping rule from
[RFC 0013](0013-hosted-open-weights.md). Keep `xiaomi` as the existing synchronous
provider. This document proposes a transport; it does not implement or enable it.

Read through the [Batch method](../../wiki/xiaomi-batch.md),
[wiki index](../../wiki/index.md), and [typed graph](../../wiki/graph.json).
Jamie owns the adoption decision. Merging the RFC does not establish live
acceptance, authorize a purchase, or start a photo upload.

## Current evidence and limits

At reference commit `fa8ddc7`, the [Xiaomi provider](../../src/providers/xiaomi.js)
sends synchronous `/chat/completions` requests. Its
[builder](../../src/core/xiaomi.js) has no Batch or Flex switch.
`--batch-size 10` means ten images in one request, not discounted Batch execution.
The [OpenAI Batch adapter](../../src/providers/openai-batch.js) supplies lifecycle
ideas, but its endpoints, credentials, cache controls, and Flex policy are not a
Xiaomi capability contract.

The [v3 live report](../../evals/reports/xiaomi-parallel-capacity-pilot-2026-10-26.json)
records synchronous ten-image requests, overlap at two, and nonzero cached input.
It reused ten derivatives under a short brief. It does not verify multimodal
Batch, account eligibility, queue latency, the exhibition brief, or savings.

## Dated vendor evidence

Checked **2026-10-27**. These published claims are not account or inference tests:

| Source | Documented behavior | Gate before adoption |
| --- | --- | --- |
| [Batch API](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/batch-api) | Supports lowercase `mimo-v2.6-pro`; JSONL, unique `custom_id`, one endpoint per file; default file limit 128 MB. | Verify account eligibility, actual regional origin, quotas, and ten-image bodies. |
| Same Batch source | Off-peak scheduling; partial successes are billed; failed requests require a new job, not in-job resume. | Verify status, cancellation, partial-output, and billing behavior. |
| Same Batch source | File/results retention defaults to 30 days; job deletion is terminal-only. | Verify file cleanup separately; job deletion is not proof of file deletion. |
| [Image inputs](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/image-understanding) | General image API accepts multiple base64 inputs within context limits. | This does not prove that the regional Batch route accepts the same payload. |
| [Account regions](https://mimo.mi.com/docs/en-US/quick-start/faq/account) | Regional keys and base URLs are not interchangeable. | Verify the account's own Batch key/origin binding without exposing credentials. |

The Batch guide describes 1–14-day timeouts but its API field table fixes
`completion_window` at `24h`. Its 01:00–08:00 off-peak interval has no stated
timezone. Record both discrepancies; do not infer a completion guarantee or
schedule the application around an assumed timezone. The account page limits
some identity-verification requirements to domestic users, while the Batch
prerequisites are broader. Resolve eligibility for this overseas account.

## Cost and caching

The [dated overseas tariff](https://mimo.mi.com/docs/en-US/price/pay-as-you-go)
lists these USD rates per million tokens:

| Transport | Uncached input | Cached input | Output |
| --- | ---: | ---: | ---: |
| Existing synchronous Xiaomi | 0.435 | 0.0036 | 0.87 |
| Proposed Xiaomi Batch | 0.2175 | 0.0018 | 0.435 |

Batch and cache-hit rates combine. Cache writes are temporarily free; future
tariffs and actual hit rates remain unknown. The same hypothetical one million
uncached input plus 100,000 output tokens costs $0.522 synchronously or $0.261
through Batch, before other charges. This arithmetic is not a matched-photo
benchmark or an invoice forecast.

Store reported input, cached input, output, image and reasoning counts for every
attempt, including invalid replies and repairs. Count image/reasoning breakdowns
only within their parent totals. Keep missing usage or an unknown tariff null,
not zero. Record currency, transport, rate edition, estimate, and reconciled bill
separately. Repeated images, recursive levels, and the final target of ten can
produce many paid requests; neither a worker ceiling nor that target caps spend.

## Proposed interface and rollout

After implementation and acceptance, select `--provider xiaomi-batch` with
`--model mimo-v2.6-pro --batch-size 10 --reasoning-effort auto`, the same absolute
context path, exact curator list, and final `--target-level-size 10`.
**These proposed arguments are not runnable on the current branch.**

Start with one local publisher and at most one outstanding remote job. Initially
require `--workers 1 --concurrency 1` and reject adaptive-worker flags. Xiaomi
chooses execution within a job; these local bounds do not establish host request
concurrency. A job may contain several independent ten-image requests. Its
validated profile must set finite request-count and encoded-file-byte limits;
the first live gate is capped at three paid inference attempts across all jobs,
at most two requests per job, and 100,000,000 encoded bytes per input file.
Repairs and Act II consume the same cumulative allowance. Unfinished accepted
requests retain their cost reservations even after local pause or cancellation.
Before upload, record a finite USD ceiling and reserve a conservative upper cost
for every attempt against verified profile limits; unknown bounds hold the pilot.
If the allowance runs out, leave remaining checks pending for a separately bounded
successor pilot. Future limits need quota and cost evidence before expansion.

Rerunning the same command resumes a known job or returns a completed local
receipt. Status and explicit cancellation must also work from a saved private
job ID after restart. Final names for those maintenance commands can be chosen
during implementation. `--github-all`, knowledge modes, Flex, explicit verbosity,
generic `--retry-needs-review`, and automatic synchronous fallback remain outside
the first Batch release. Reject them before upload.

## Transport, provenance, and recovery

1. **Bind the destination.** Use only `MIMO_API_KEY`, resolved for the verified
   region. Obtain the concrete Batch origin from the account console and bind it
   in a reviewed capability profile. The documented `batch-api-${region}` host
   pattern is not an allowlist or permission to guess a region. Require the
   exact approved HTTPS origin on upload, create, status, download, and cleanup;
   reject redirects, userinfo, arbitrary result URLs, and credential fallback.
   A different required key needs explicit installation at the intended host.
2. **Freeze before upload.** Snapshot source and derivative hashes, ordered
   filenames, base and per-batch finalized curator rosters, rendered instruction
   bytes, metadata, context, template, output schema, and code identity. Preserve
   the AGENTS two-phase contract and fictional-lens framing. No database or hidden
   model state is introduced. A repair or Act II retains the batch's frozen inputs.
3. **Prepare bounded JSONL.** Reuse the Xiaomi request body and local validator;
   each line wraps `custom_id`, `method: POST`, `url: /v1/chat/completions`, and
   `body`. Use opaque IDs, never private filenames, with a private mapping to the
   request hash, phase, attempt, and ordered image hashes. Measure serialized
   UTF-8 bytes including base64 expansion, JSON escaping, and newlines. Split
   files only between requests. Hold an oversized single request before upload;
   never silently drop images, shrink the roster, or alter the prompt.
4. **Persist each side effect.** Keep append-only attempt history and atomic
   snapshots in a private local journal without an outgoing remote. Save the
   input hash, upload intent, returned file ID, create intent, returned job ID,
   endpoint/profile, accepted window, timestamps, and current state before the
   next side effect. A proposed `xiaomi-batch-v1-` identity separates transport,
   region, profile, model, settings, code, and complete request/image bytes from
   synchronous caches. Preserve predecessor identities and receipts.
5. **Resume known work.** Reattach to a saved job; bounded, backed-off polling may
   retry safe reads. An uncertain upload/create/cancel response enters
   `submission_unknown` or `cancellation_unknown` and stops new writes. No blind
   POST retry or automatic replacement job is allowed. A local lock prevents two
   processes publishing the same work. Recovery requires evidence of what the
   server accepted; no undocumented remote idempotency guarantee is assumed.
6. **Reconcile before applying.** Persist and hash raw output/error files. Check
   the complete expected ID set before applying any result from that job.
   Duplicate IDs (even identical lines), conflicts, foreign IDs, malformed JSONL,
   or a truncated download hold the whole job's unapplied results. Once the
   download and ID mapping are trusted, missing known IDs and explicit per-request
   errors hold their affected logical units; intact siblings can progress.
   Require HTTP success, exact
   model identity, complete finish status, JSON parse, and ordinary phase/filename
   validation per result. Valid partial successes can be committed and applied
   once after reconciliation. Moves additionally require the logical image
   unit's triage, any permitted repair, and any required Act II to be validated
   and committed against the correct prior notebook hash. A terminal job status
   alone is not a valid photographic decision.
7. **Keep phases dependent.** One invalid response permits the existing single
   explicit JSON/contract repair, submitted as a new Batch request with a parent
   link. Log `retry_recovered` on recovery. A second invalid reply emits the
   existing repair suggestion and holds its files. Act II is submitted only
   after validated triage requires it. With field notes, serialize whole batch
   sessions so each reads the preceding notebook; without them, independent
   triage requests may share a job. Missing results and transport errors are not
   JSON repairs. No synchronous repair or higher-price fallback.
8. **Apply once.** Before dependent submissions, validated curation commits,
   notebook updates, or moves, recheck frozen source/context/template/code bindings.
   Drift still permits raw output/error downloads and custody/held-state commits
   under the original binding, without applying their decisions. Resume validation
   in the exact frozen edition, or create a separate successor revalidation receipt
   linked to the original raw hashes; never rewrite a completed receipt. Serialize
   private Git writes and commit response JSON with derived field notes atomically.
   Record phase validation and applied-file progress durably; restart reconciles
   moves by path and hash and never guesses or blindly repeats a partial move.
   Do not descend to another recursive level until the current level has no
   pending or held images and passes the existing stop-rule checks.
9. **Hold billing and cancellation.** Billing/auth/quota failures stop new jobs
   and dependent submissions. Preserve already accepted remote work and collect
   available results without silently restarting it. Cancellation records intent
   and acknowledgement, then reconciles final status and partial billed output;
   acknowledging cancellation does not prove all inference stopped. Plain restart
   does not resubmit failed/missing work. Any separately authorized replacement
   includes only reconciled failures and links the prior job and attempt.
10. **Account for retained files.** JSONL carries private images, tags, and brief
    text. Store it privately with restrictive permissions and exclude credentials
    from payloads, logs, and Git. After safely capturing results, remove uploaded
    and result files only through verified supported cleanup operations. Record
    each outcome; failed or unavailable cleanup remains a retention hold, not
    a claim of deletion. That hold blocks new uploads and cleanup/adoption
    acceptance, while allowing safe custody reads. It does not invalidate completed
    curation receipts or cause inference replay. Do not delete active-job inputs. Preserve local receipts
    and document the vendor's default 30-day remote retention and its limits.

Initial modules should keep pure preparation/reconciliation/state reducers in
`src/core/`, network I/O in a dedicated provider, and lifecycle persistence in a
separate private Batch journal. The existing `hostedRun.js` admits only
`deepinfra`/`xiaomi` and records `chat-completions`; extend its schema deliberately
or add a dedicated journal with a `xiaomi-batch-source-` namespace. Keep mutable
job operations separate from immutable validated request receipts. One durable
coordinator owns polling and downloads for each job, shared by its collectors,
with bounded read concurrency and download sizes. Reuse existing prompt/schema/image helpers and
orchestrator apply logic. Audit the OpenAI adapter before borrowing general
lifecycle code; do not point that adapter or the synchronous Xiaomi validator at
a new hostname. Prompts remain data-only.

## Evaluation and acceptance plan

All checks below are **proposed, not implemented or passed by this RFC**.

| Check | Required evidence |
| --- | --- |
| Input preservation | Default/custom prompt bytes, exact 17-name roster, isolated repeated-tag additions, ten images and tail, both phases, and context survive JSONL round trips. |
| Destination and size | Reject wrong region/origin/redirects/credentials; measure actual encoded bytes; split at request boundaries and reject oversized single requests. |
| Job reconciliation | Out-of-order, duplicate, foreign, missing, conflicting, truncated, failed, and partial outputs exercise holds and exactly-once application. |
| Crash recovery | Interrupt before/after upload, create, poll, download, commit, and each move; resume known jobs and never duplicate uncertain submissions. |
| Phase safety | One repair across restarts, recovery event, final question, exact filename decisions, serial notebook sessions bound to the prior notebook hash, drift holds, billing, cancellation, and cleanup failures. |
| Cost accounting | Cached/uncached inputs, reasoning/image breakdowns, unknown usage, partial billing, repairs, request-volume caps, and provider-separated cache identities. |
| Ordinary workflow | Actual launcher/factory/adapter/journal fixtures substitute network only; preserve sorting, pending-level barriers, recursive stopping, and other providers. |
| Bounded live gate | Within the shared three-attempt/cost allowance, test one ten-image request then a job of two independent ten-image requests; repairs/Act II reduce the remaining allowance. Inspect IDs, usage, hashes, private atomic commits, moves, and cleanup. |
| Editorial and savings gate | Compare reviewed working copies under the actual exhibition brief with the same inputs/settings; record human agreement, valid replies, repair cost, elapsed time, and reconciled bills. |

During implementation, add focused evaluators, run them before broad repository
checks, and bind receipts to exact candidate bytes. Preserve historic synchronous
pilots. Keep offline validity tests distinct from observed model JSON validity;
target at least 99% JSON validity without claiming a tiny pilot establishes it.
Report `json_validity_rate`, `retry_recovery_rate`, and
`todos_addressed/total_todos`; unavailable live measurements remain null.

## Decision gates and alternatives

Implementation, synthetic checks, account access, multimodal Batch acceptance,
recovery/cleanup behavior, and Jamie's editorial acceptance are separate gates.
All Batch gates remain pending. A pilot uses copied photos under an explicit
request and cost bound; creating this RFC makes no inference calls or purchases.
The capability profile must record supported completion-window fields/values
and evidence of their expiry behavior, not merely a successful create response.
If the regional contract remains unresolved, keep production acceptance pending
and perform only a bounded probe with an explicit local wait/stop policy that
preserves the remote job ID. A local timeout never proves remote expiry.

Continue synchronous Xiaomi for immediate results and existing automatic cache
hits. Keep OpenAI Batch as an independent established transport. Xiaomi Batch
offers a documented unit-price discount in exchange for queueing and additional
lifecycle work. Flex and any broader provider abstraction can be assessed later.
Adopt Batch only after the above gates establish useful results and actual costs.
