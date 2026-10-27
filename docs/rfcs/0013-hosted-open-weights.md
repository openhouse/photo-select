---
id: photo-select-rfc-0013
title: Hosted open-weight providers, beginning with MiMo on DeepInfra
kind: research-inquiry
status: draft
visibility: public-safe
sensitivity: low
last_reviewed: 2026-10-26
canonical_path: docs/rfcs/0013-hosted-open-weights.md
summary: Implement a reusable hosted-provider boundary while retaining separate live acceptance and editorial review.
rfc: 0013
stage: proposed
start_date: 2026-10-26
authors: [Jamie Burkart, Codex]
champion: Jamie Burkart
decision_owner: Jamie Burkart
review_areas: [provider compatibility, photographic usefulness, cost accounting, source custody]
implementation: Dedicated DeepInfra provider implemented and mock-tested; live acceptance pending.
xiaomi_implementation: Dedicated Xiaomi provider implemented and mock-tested; production live acceptance pending.
supersedes: []
superseded_by: []
relations: [{type: uses_method, target: photo-select-hosted-open-weights, href: ../../wiki/hosted-open-weights.md, context: Reusable hosted-provider method.}]
---

# RFC 0013 — Hosted open weights, beginning with MiMo on DeepInfra

## Proposal and scope

Add a dedicated `deepinfra` provider for `XiaomiMiMo/MiMo-V2.6-Pro`, using a
provider contract that can accommodate other hosted open-weight services.
Keep the existing photographic workflow and let a measured comparison determine
whether a provider is useful. This RFC remains **proposed**. The dedicated
provider is implemented with synthetic transport and workflow tests. Account
authorization and synthetic image/schema requests have since passed live checks.
A real-photo pilot found a four-image request limit and completed after the
batching fix. Broader photographic usefulness and savings remain unverified;
no default switch is established.

Enter through the [Knowledge Wiki](../../wiki/index.md) and its
[hosted-provider method](../../wiki/hosted-open-weights.md). The
[authored graph registry](../../wiki/graph.json) connects the proposal, method,
and dated vendor sources. It is a local adaptation of the public, revision-pinned
[record schema](https://github.com/openhouse/jamieburk.art/blob/cf9415b4a93f336dbd0fa50ab6edf5442d113a96/docs/knowledge-bank/schema.md)
and [RFC stages](https://github.com/openhouse/jamieburk.art/blob/cf9415b4a93f336dbd0fa50ab6edf5442d113a96/rfcs/README.md).
Merge preserves this proposal; it does not establish adoption or live readiness.

[RFC 0014 — Xiaomi Batch](0014-xiaomi-batch.md) separately proposes discounted
asynchronous processing. Its job lifecycle, regional access, and multimodal
acceptance require their own evidence; the synchronous pilots below remain bound
to their original transport.

## Why a provider boundary

Jamie expects to use hosted open weights increasingly. An endpoint override can
test compatibility, but cannot establish equivalent schemas, thinking controls,
image handling, caching, tools, billing, or retention. Separate model capability,
hosting service, API transport, account authorization, and editorial judgment.
Open weights can still be served remotely; sending a photograph is a provider upload.

At proposal time the providers were `openai`, `openai-batch`, and `ollama`.
The ordinary OpenAI shim honored `OPENAI_BASE_URL`, but sent a schema-bearing
`json_object`, attaches unsupported DeepInfra image `detail`, and does not forward
MiMo reasoning settings. Its streaming path does not retain detailed billed usage.
The existing cache identity omitted endpoint and some settings. The dedicated
adapter now supplies its own request, credential, usage and cache boundaries.
The earlier endpoint-override preview is not evidence of live compatibility.

## Dated provider evidence

Vendor documentation was read on **2026-10-26**. These are changeable claims,
not successful API tests. Source IDs and URLs live in the
[evaluation profile](../../evals/hosted-open-weights.json).

| Topic | Documented claim | Acceptance boundary |
| --- | --- | --- |
| Identity | DeepInfra alias `XiaomiMiMo/MiMo-V2.6-Pro`; advertised FP8 | Hosted weights revision and hash unknown. |
| API | `https://api.deepinfra.com/v1/openai/chat/completions` | Authentication and a bounded six-photo pilot completed; general acceptance remains pending. |
| Context | 1,048,576 tokens; multimodal input | Tokenizer, effective image budget and output limits need verification. |
| Images | Multiple base64/URL images; JPG/PNG/WebP, 20 MB/image | Live API reports at most four images per request. Omit unsupported `image_url.detail`. |
| Output | JSON mode and strict `json_schema` documented | Live image/schema requests completed, including one contract repair; editorial reliability remains unverified. |
| Thinking | General reasoning controls and output billing documented | No verified MiMo mapping for `minimal` or `xhigh`. |
| Cache | Automatic prefix reuse and cached-token reporting | No guaranteed MiMo hit rate or explicit retention support. |
| Batch | Chat Completions batch documented, 20% below realtime | Application support deferred; Responses batches are unsupported. |
| Privacy | Inference/no-training policy; separate metadata and bulk retention | Record the policy for the actual mode and date. |

Live checks on **2026-10-26** exercised authentication, synthetic images, strict
JSON, field notes and private receipts. A valid selection still contradicted its
own reason, so these checks did not establish reliable photographic judgment.
A real-photo follow-up returned HTTP 400 with
`Too many images in request: 6 > 4` at a 768-pixel maximum image edge.
The capability profile now caps batches at four images and rejects larger direct
provider requests before upload. Reducing image dimensions does not remove this
image-count limit.

The [bounded real-photo report](../../evals/reports/deepinfra-real-photo-pilot-2026-10-26.json)
records six reviewed copies processed as four plus two. Five responses parsed;
one omitted the closing question and recovered with the single repair. The final
five keeps and one aside agreed with their reasons, discussion, notebook and file
moves. Independent assistant review found specific correct visible detail for all
six, alongside unsupported motion/time claims and broken notebook photo links.
Reported cost was about $0.01665 for the five successful requests, including the
repair; the two preceding HTTP 400 rejections reported no usage or cost.
This custom-prompt, vision-only pilot is not Jamie's editorial approval or
evidence of unattended readiness or comparative savings. The original proposal
profile and offline receipt retain their unexecuted acceptance boundary; this
separate live report names its actual sample and limitations.

A separate [Xiaomi direct compatibility report](../../evals/reports/xiaomi-direct-compatibility-pilot-2026-10-26.json)
records one ten-photo group in a private harness using the shared image builder
and reply validation. Triage, one closing-question repair, and Act II each sent
ten independent images and returned HTTP 200. All three replies parsed; the two
final phases passed local validation. The run took about 123 seconds and its
usage-based estimated cost was $0.01485 including repair, before billing
reconciliation. Assistant visual review found correct image mapping and useful
visible details, alongside a wrong bud count, overstated bird orientation and
unsupported time/season claims. JSON mode with local validation does not prove
strict server-side schema support. This is compatibility evidence for another
host, not production Xiaomi CLI integration, unattended readiness, comparative
savings or a reason to raise DeepInfra's four-image cap. An earlier HTTP 402
request reported no usage or cost and remains a separate historical receipt.

## Xiaomi runtime

The `xiaomi` provider now implements ordinary photo curation and both field-note
phases through `https://api.xiaomimimo.com/v1`, model `mimo-v2.6-pro`, using only
`MIMO_API_KEY`. It shares the filename/phase validation and private journal while
binding provider identity separately. Synthetic provider, CLI, workflow and
launcher tests exercise the implementation. The predecessor harness report above
remains historical and is not relabeled as a production CLI test.

Xiaomi uses `json_object` and local validation; strict server-side schema
enforcement is not requested. Its profile caps requests at ten independent images,
including repairs and Act II. `--batch-size 10` selects this request size explicitly
and does not depend on worker count. `--target-level-size` remains the completed
level stopping target. The provider supports `auto` reasoning. Fixed and adaptive
workers accept bounds from one to 50, using one shared admission pool for every
POST across triage, repair and Act II. Adaptive mode starts at the requested
minimum and grows after two consecutive valid responses, never above the worker
ceiling. Fifty is a local safety limit, not verified hosted account capacity.
Fatal holds reject queued work; active requests finish preserving receipts.
Rate-limit and ambiguous transport failures are not automatically retried.
With field notes, serialize whole batch sessions and log the constraint so
concurrent snapshots cannot clobber cumulative notebook updates.
Explicit verbosity, knowledge/GitHub modes and automatic review retries remain
unsupported. Preserve the user's exact curator
list, complete context, repeated-tag additions, ordering and frozen batch roster.

The [Xiaomi profile](../../evals/xiaomi-open-weights.json) binds dated
[API](https://mimo.mi.com/docs/en-US/api/chat/openai-api) and
[pricing](https://mimo.mi.com/docs/en-US/price/pay-as-you-go) sources, the immutable
harness receipt, and pending production acceptance. Current overseas realtime
rates per million tokens are $0.435 uncached input, $0.0036 cached input and
$0.87 output. Cache writes are temporarily free in the documentation; the profile
keeps an unpublished durable cache-write tariff unknown. Image and reasoning
breakdowns are included in input and output totals respectively, not added again.
No production live result or comparative savings is established by these offline
tests. See the [launcher command](../../README.md#mimo-v26-pro-directly-from-xiaomi).

The model page embeds RL material while its Project link currently resolves to
[MiMo-V2.6-Pro-MOPD](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-MOPD).
Neither establishes DeepInfra's deployed revision. Keep the served alias,
advertised precision, returned model ID, and attested revision separate.
The RL/MXFP label visible in OpenCode does not establish the hosted deployment's
checkpoint or precision.

## Reusable contract

1. **Identity and credentials:** bind provider ID, HTTPS origin, API transport,
   model alias, precision, requested settings, and capability-profile revision.
   Use `DEEPINFRA_API_KEY` only at DeepInfra and `MIMO_API_KEY` only at Xiaomi. Never read keys from
   OpenCode implicitly, place them in prompts, or fall back to an OpenAI credential.
2. **Capabilities:** record `documented`, `mock-tested`, `live-tested`,
   `unsupported`, or `unknown` per feature. Distinguish requested, accepted,
   and verified settings. Reject an unsupported request before paid submission.
   `auto` may explicitly request the provider's default; record that uncertainty.
   Never silently translate `xhigh` to `high` or lower effort to recover a failure.
3. **Request construction:** render the same default/custom prompt and complete
   context. Preserve filename order, per-image metadata, repeated-tag curator
   additions, identity policy, and the frozen per-batch roster. DeepInfra uses strict
   JSON Schema wrapping; Xiaomi uses JSON object mode. Retain local validation in
   both. Limit DeepInfra to four images and Xiaomi to ten, including repair and
   field-note passes. Treat source text as data.
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

The implementation preserves AGENTS v2.0.0, prompt text, image selection, recursive
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

## Normal-launcher ten-photo evidence

The [Xiaomi CLI test](../../evals/reports/xiaomi-cli-real-photo-pilot-2026-10-26.json)
completed ten-photo triage and Act II with all 17 supplied curator names, a short
test brief, one worker and one nonrecursive level. Both HTTP 200 replies passed
JSON and contract validation on arrival: 34 minutes, eight keeps and two asides,
with no repair. Estimated token cost was $0.01519; billing is not reconciled.
Private working-copy hashes, archives, sorting, notebook links and atomic Git
provenance were verified. The original Photos library was unchanged.

The predecessor candidate produced JSON with decision text nested inside minutes
and omitted the required top-level decisions. Its one repair failed, so the run
held without moving photos; estimated token cost was $0.01161. The successor
repeats the complete schema in repair instructions and binds both phases to the
same source hashes, context and template. Mutation checks hold changed inputs
before another POST, notebook update or sorting. The Xiaomi cache/profile prefix
advanced to v2; predecessor receipts remain historical. The later concurrency
implementation advances the runtime profile and request identity to v3. Shared
pool ceilings, adaptive growth, field-note serialization and fatal queue holds
are exercised by local substituted-transport tests. The bounded v2 live result
does not establish live parallel capacity or reliability.

The live execution recorded its base revision and the v2 candidate source digest,
including uncommitted implementation changes. The report binds that recorded
edition; its live evidence does not cover the later v3 concurrency changes.
This is bounded CLI compatibility evidence;
the exhibition brief, broad editorial reliability, unattended use, adaptive
capacity, comparative savings and large-library recursion remain unmeasured.

## Parallel and adaptive live capacity evidence

The [profile-v3 capacity report](../../evals/reports/xiaomi-parallel-capacity-pilot-2026-10-26.json)
keeps two bounded normal-launcher runs separate. Fixed mode verified two
overlapping hosted requests, each with ten images and all 17 supplied names;
both replies passed the contract without repair. Adaptive mode completed four
batches, grew its target from one to two, and recovered two contract repairs;
its observed HTTP peak was one. All eight HTTP replies parsed as JSON.

These runs reused ten previously inspected derivatives as 20 and 40 working
copies. The fixed test controlled selection order so each request received an
ordered ten-image group. Working-copy sorting, frozen hashes, and atomic private
response/aggregate-notebook commits were verified. Reported-token estimates were
$0.01877 fixed and $0.04515 adaptive, including invalid replies and repairs;
billing reconciliation remains pending. Source originals and the Photos catalog
were unchanged. This establishes bounded overlap at two and adaptive admission,
not a fifty-request hosted quota, a corpus of sixty unique photographs, editorial
acceptance, comparative savings or large-library recursion.

## Evaluation and hill climb

`evals:hosted-open-weights` checks the graph/profile, source joins, proposal
lifecycle, conservative cost arithmetic, and the implemented provider's synthetic
request and workflow cases. It binds the evaluated source and test bytes.
Mutation tests reject false readiness, invented live evidence, wrong model/rate
binding, broken links, missing evidence, invalid usage and double-counted reasoning.
Transport fixtures cover strict-schema/image requests, credential destination,
cache isolation, usage capture, bounded repair and terminal failures. CLI tests
reject unsupported reasoning and knowledge modes before photo processing.
Mock transport checks establish local behavior; they do not establish successful
vendor acceptance or measure the model's photographic judgment.

Continue with a user-started, explicitly budgeted live pilot on copied photographs.
Freeze prompt, context, images, roster, order and model/tier settings. Hold out
events and photo bursts from tuning. Compare useful-positive and adverse cases,
including subtle near alternatives, reordered images and unsupported social claims.
Jamie reviews visible grounding, interpretation, disagreements and editorial use.
No aggregate score compensates for invented attribution or invalid file decisions.

Track `json_validity_rate`, `retry_recovery_rate`, latency, filename fidelity,
order sensitivity, and cost per accepted batch. Real-photo editorial metrics
remain **unmeasured**.
Any synthetic JSON/retry measurements in the receipt name their fixture population
and remain separate from live rates.
Run focused tests, inspect failures, improve the candidate, then run
`npm run hillclimb` and `git diff --check`. The receipt binds candidate bytes and
keeps offline results separate from provider authorization, live acceptance and CI.

## Rollout and open decisions

The dedicated provider and offline runtime gates precede a bounded pilot.
After pilot review, compare usefulness/cost before expanding provider profiles.
DeepInfra Batch and GitHub tools each need their own implementation and acceptance.
Keep the current provider available. Rollback disables the new provider, preserves
completed results and marks affected receipts stale; it never relabels failed work.
Decisions remain open on MiMo thinking controls, deployed checkpoint attestation,
account limits, retention mode, pilot corpus/budget and adoption. No paid work,
model default, operational readiness, or human approval is established by this RFC.
