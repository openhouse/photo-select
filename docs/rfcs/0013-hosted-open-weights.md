---
id: photo-select-rfc-0013
title: Hosted open-weight providers, beginning with MiMo on DeepInfra
kind: research-inquiry
status: draft
visibility: public-safe
sensitivity: low
last_reviewed: 2026-10-26
canonical_path: docs/rfcs/0013-hosted-open-weights.md
summary: Propose a reusable provider boundary and evidence-led comparison for hosted open weights.
rfc: 0013
stage: proposed
start_date: 2026-10-26
authors: [Jamie Burkart, Codex]
champion: Jamie Burkart
decision_owner: Jamie Burkart
review_areas: [provider compatibility, photographic usefulness, cost accounting, source custody]
implementation: Offline design evaluator only; provider implementation and live acceptance pending.
supersedes: []
superseded_by: []
relations: [{type: uses_method, target: photo-select-hosted-open-weights, href: ../../wiki/hosted-open-weights.md, context: Reusable hosted-provider method.}]
---

# RFC 0013 — Hosted open weights, beginning with MiMo on DeepInfra

## Proposal and scope

Add a dedicated `deepinfra` provider for `XiaomiMiMo/MiMo-V2.6-Pro`, using a
provider contract that can accommodate other hosted open-weight services.
Keep the existing photographic workflow and let a measured comparison determine
whether a provider is useful. This RFC is **proposed**. This change implements
an offline graph/accounting evaluator, not a provider, paid pilot, or default switch.

Enter through the [Knowledge Wiki](../../wiki/index.md) and its
[hosted-provider method](../../wiki/hosted-open-weights.md). The
[authored graph registry](../../wiki/graph.json) connects the proposal, method,
and dated vendor sources. It is a local adaptation of the public, revision-pinned
[record schema](https://github.com/openhouse/jamieburk.art/blob/cf9415b4a93f336dbd0fa50ab6edf5442d113a96/docs/knowledge-bank/schema.md)
and [RFC stages](https://github.com/openhouse/jamieburk.art/blob/cf9415b4a93f336dbd0fa50ab6edf5442d113a96/rfcs/README.md).
Merge preserves this proposal; it does not establish adoption or live readiness.

## Why a provider boundary

Jamie expects to use hosted open weights increasingly. An endpoint override can
test compatibility, but cannot establish equivalent schemas, thinking controls,
image handling, caching, tools, billing, or retention. Separate model capability,
hosting service, API transport, account authorization, and editorial judgment.
Open weights can still be served remotely; sending a photograph is a provider upload.

Today `src/providers/index.js` exposes `openai`, `openai-batch`, and `ollama`.
The ordinary OpenAI shim honors `OPENAI_BASE_URL`, but sends a schema-bearing
`json_object`, attaches unsupported DeepInfra image `detail`, and does not forward
MiMo reasoning settings. Its streaming path does not retain detailed billed usage.
The existing cache identity omits endpoint and some settings. Thus the command
preview discussed in this chat remains experimental, not supported acceptance evidence.

## Dated provider evidence

Vendor documentation was read on **2026-10-26**. These are changeable claims,
not successful API tests. Source IDs and URLs live in the
[evaluation profile](../../evals/hosted-open-weights.json).

| Topic | Documented claim | Acceptance boundary |
| --- | --- | --- |
| Identity | DeepInfra alias `XiaomiMiMo/MiMo-V2.6-Pro`; advertised FP8 | Hosted weights revision and hash unknown. |
| API | `https://api.deepinfra.com/v1/openai/chat/completions` | Full photo request remains untested. |
| Context | 1,048,576 tokens; multimodal input | Tokenizer, effective image budget and output limits need verification. |
| Images | Multiple base64/URL images; JPG/PNG/WebP, 20 MB/image | `image_url.detail` is unsupported; omit it explicitly. |
| Output | JSON mode and strict `json_schema` documented | MiMo plus our exact schema and images remains untested. |
| Thinking | General reasoning controls and output billing documented | No verified MiMo mapping for `minimal` or `xhigh`. |
| Cache | Automatic prefix reuse and cached-token reporting | No guaranteed MiMo hit rate or explicit retention support. |
| Batch | Chat Completions batch documented, 20% below realtime | Application support deferred; Responses batches are unsupported. |
| Privacy | Inference/no-training policy; separate metadata and bulk retention | Record the policy for the actual mode and date. |

The model page embeds RL material while its Project link currently resolves to
[MiMo-V2.6-Pro-MOPD](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-MOPD).
Neither establishes DeepInfra's deployed revision. Keep the served alias,
advertised precision, returned model ID, and attested revision separate.
The RL/MXFP label visible in OpenCode does not establish the hosted deployment's
checkpoint or precision.

## Proposed reusable contract

1. **Identity and credentials:** bind provider ID, HTTPS origin, API transport,
   model alias, precision, requested settings, and capability-profile revision.
   Use `DEEPINFRA_API_KEY` only at the DeepInfra destination. Never read keys from
   OpenCode implicitly, place them in prompts, or fall back to an OpenAI credential.
2. **Capabilities:** record `documented`, `mock-tested`, `live-tested`,
   `unsupported`, or `unknown` per feature. Distinguish requested, accepted,
   and verified settings. Reject an unsupported request before paid submission.
   `auto` may explicitly request the provider's default; record that uncertainty.
   Never silently translate `xhigh` to `high` or lower effort to recover a failure.
3. **Request construction:** render the same default/custom prompt and complete
   context. Preserve filename order, per-image metadata, repeated-tag curator
   additions, identity policy, and the frozen per-batch roster. Use standard strict
   JSON Schema wrapping and retain local validation. Treat source text as data.
4. **Results and repair:** preserve phase-specific keys, exact filename coverage,
   the final question, and all valid minutes. Distinguish provider failure from a
   valid `aside`. Preserve the contract's single JSON repair, `retry_recovered`,
   and terminal `repair_suggestion`; keep transport retries separately bounded.
   Do not resubmit a completed result because private persistence failed.
5. **Audit and cache:** preserve original and submitted-image content hashes,
   prompt bytes/hash, schema, roster, provider/endpoint/transport/model/settings,
   code revision, request hashes, timestamps, attempts and returned usage.
   `model_sha256` is a request hash, not a remote weights hash.
   Serialize atomic response/notebook Git commits. Add a new hosted cache prefix
   binding this identity; do not reuse the current response-cache namespace.
6. **Cost and capacity:** retain raw usage and billing semantics, latency,
   cache reads/writes, reasoning and failed attempts. Unknown is not zero.
   Begin with one worker, then evaluate bounded adaptive concurrency, 429 handling,
   billing pauses, timeout ambiguity and resume without duplicate paid work.

This proposal preserves AGENTS v2.0.0, prompt text, image selection, recursive
stopping, source snapshots and output placement. All named voices remain fictional
lenses. See [RFC 0010](0010-content-addressed-people-prefetch.md) for metadata
identity and [RFC 0012](0012-live-knowledge-exploration.md) for prompt preservation.

## GitHub tools and knowledge boundaries

Keep `--github-all` restricted to the current OpenAI transport until a separate
DeepInfra function-call loop preserves authenticated read-only access, prompt
bytes, tool traces and private provenance. A link or a function-calling badge
does not establish repository access. Never silently run image-only after a
requested knowledge failure. The earlier research-first path remains a separate mode.

Semantic links explain the proposal. Evidence links support bounded claims.
Credentials, private image paths, context bodies, responses and paid-run receipts
stay outside this public graph. Neither graph reachability nor preservation
supplies source truth, publication approval, real participation or consent.

## Cost comparison

The dated non-promotional DeepInfra rates are USD per million tokens:
**0.43 input, 0.004 cached input, 0.87 output**; cache-write price is unknown.
Do not assume the displayed 10% promotion or Batch discount stacks with another tier.
For input total `I`, cached reads `C`, writes `W`, and billable output `O`:

`USD = ((I-C-W)*input + C*cachedInput + W*cacheWrite + O*output) / 1,000,000`.

The adapter must verify these input categories are disjoint and exhaustive.
If `O` already includes reasoning, do not add it again. If it excludes reasoning,
add separately billed reasoning once. Missing required usage, rate, or semantics
makes the total unknown. Preserve provider-reported charges separately from estimates.
The offline function has no discount, authorization or performance authority.
At assumed 100,000 uncached input and 10,000 total output tokens, the estimate is
**$0.0517** before other charges. This is a scenario, not a measured ten-photo price.

Compare the same frozen corpus against the selected OpenAI model and tier using
each service's actual billed tokens. Separate cold cache, warm cache, writes,
reasoning, retries and human correction. Report cost per accepted batch and per
completed level. Cheaper tokens alone do not prove cheaper useful work.

## Evaluation and hill climb

This change's `evals:hosted-open-weights` checks the actual graph/profile, source
joins, proposal lifecycle and conservative cost arithmetic. Mutation tests must
reject false readiness, wrong model/rate binding, broken links, missing evidence,
invalid usage and double-counted reasoning. These are offline design checks;
they do not test an implemented provider or estimate live model quality.

Implementation gates follow: strict-schema/images request fixtures; filename and
roster isolation; malformed/extra/truncated replies; bounded repair and safe holds;
credential destination; cache isolation; usage capture; restart and ambiguous
timeout behavior; and explicit GitHub-mode rejection. Add those regressions when
the adapter exists. Do not label this RFC's reference checks as those runtime tests.

Then use a user-started, explicitly budgeted live pilot on copied photographs.
Freeze prompt, context, images, roster, order and model/tier settings. Hold out
events and photo bursts from tuning. Compare useful-positive and adverse cases,
including subtle near alternatives, reordered images and unsupported social claims.
Jamie reviews visible grounding, interpretation, disagreements and editorial use.
No aggregate score compensates for invented attribution or invalid file decisions.

Track `json_validity_rate`, `retry_recovery_rate`, latency, filename fidelity,
order sensitivity, and cost per accepted batch. They remain **unmeasured** here.
Run focused tests, inspect failures, improve the candidate, then run
`npm run hillclimb` and `git diff --check`. The receipt binds candidate bytes and
keeps offline results separate from provider authorization, live acceptance and CI.

## Rollout and open decisions

After proposal review: implement one dedicated provider; pass offline runtime
gates; run the bounded pilot; review usefulness/cost; then expand provider profiles.
DeepInfra Batch and GitHub tools each need their own implementation and acceptance.
Keep the current provider available. Rollback disables the new provider, preserves
completed results and marks affected receipts stale; it never relabels failed work.
Decisions remain open on MiMo thinking controls, deployed checkpoint attestation,
account limits, retention mode, pilot corpus/budget and adoption. No paid work,
model default, operational readiness, or human approval is established by this RFC.
