# RFC 0012 — GitHub exploration during photographic curation

| Field | Value |
| --- | --- |
| Status | Implemented; current acceptance gates tracked separately |
| Decision owner | Jamie Burkart |
| Author | Jamie Burkart with Codex |
| Created | 2026-09-09 |
| Revised | 2026-09-11 |
| Branch | `work/2026-09-09-knowledge` |
| Companion | [RFC 0011: private context and source policy](0011-private-knowledge-context.md) |

## Decision

The reasoning model must be able to choose authenticated GitHub reads **during the API call that curates the photographs**. The same request contains the photographs, Jamie's context, the selected curator roster, and read-only GitHub tools. A private repository URL in `--context` is a starting point for investigation, not an inaccessible pointer or a demand to prepare a source packet.

The model can read a source, reconsider a photograph, follow a graph relationship into another repository, compare recent branches, and change its interpretation before returning `minutes` and `decisions`. Exploration is optional at the model's discretion. Availability of a tool does not establish that the model used it.

Jamie explicitly clarified this requirement on 2026-09-10 and authorized read access across the GitHub account, including private repositories and reuse of existing credentials. The previous revision implemented a different sequence: local model-directed research, frozen evidence, then a separate image-curation request. That implementation remains available as `--knowledge-live`, but **does not satisfy this revision**. Its successful private-source canary is evidence for that earlier sequence only.

## Requested command and minimal application change

The intended interface is one additional flag, `--github-all`, on Jamie's existing command. Preserve `--provider openai-batch`, `--model gpt-5.6-terra`, `--reasoning-effort high`, `--workers 20`, the exact `--curators` list, `--context`, and the caller's image directory. The installed `photo-select-here.sh` path must execute the feature without asking Jamie to switch worktrees or copy credentials. The flag is implemented and installed on Jamie's Mac. The [acceptance record](../../evals/github-inference-readiness.json) distinguishes completed checks from pending gates.

Omitting the flag preserves the existing application path. Limit changes to request construction, authenticated read-only tool transport, private audit storage, the launcher, and the tests that exercise those boundaries. Retain the existing image-selection algorithm, filename whitelist, strict reply keys, and atomic response/field-note commits. No database, embeddings, index, materialized research packet, or separate research call is required.

Jamie subsequently instructed that the existing automatic additional-curator feature be restored in GitHub mode. The explicit CLI names are the immutable base roster; use the existing default roster only when none are supplied. For each batch, use the existing Photo Filter bulk prefetch (or per-file fallback) and `finalizeCurators` to append names tagged in at least two photos. Preserve the existing placeholder filtering and configured identity policy. Keep per-photo tags in the request, and use the same expanded roster for that batch's prompt, schema, reply validation, repair and private audit. Concurrent batches must not mutate a shared roster; recursive levels compute their own additions. The existing metadata opt-out and refresh flags remain effective.

Tagged people are fictionalized analytical lenses, not actual participants or quoted speakers. Repository contents cannot alter the roster. This correction changes the fixed-roster contract introduced in version 1.0.0, so AGENTS and the package advance together to 2.0.0. Private JSON records and atomic Git history preserve provenance without adding a database. This restoration uses existing photo metadata; it does not introduce a preparatory GitHub research pass.

## Prompt-preserving correction — 2026-09-11

Jamie clarified that the flag must only enable authenticated GitHub access. The
ordinary default or custom prompt is the authoritative curation instruction.
Render it through the existing template system with the same context, names,
filenames and placeholders; attach the private MCP tool separately. Do not append
the earlier GitHub research, role-play, consent or citation paragraphs. Do not
force reads or reject ordinary brief links solely because no tool fetched them.
Record actual successful tool reads separately from model text. Preserve the
ordinary free-text speaker schema so a prompt-defined facilitator may speak;
the input batch roster remains unchanged.

For cached requests, reuse the existing renderer's context boundary, concatenate
instruction blocks back to exactly the original prompt bytes, and keep dynamic
rosters and image metadata after that boundary. The `github-v3` key covers the
restored stable prefix, schema, tools, model, effort, verbosity and selected tier.
A custom prompt with no verified context boundary remains uncached. Credential
screening, the read-only bridge, private audits, bounded transport recovery,
strict reply structure, and existing image-directory behavior remain in place.

This decision supersedes the earlier injected exploration instructions and the
user-role brief layout described in the historical cache correction below. Branch
exploration recommendations in this RFC are guidance for authors of project
briefs, not mandatory prose injected by the flag. The older private and cache
canaries remain historical until fresh evidence binds this implementation.

## API mechanism

Use a remote MCP tool attached directly to the curatorial Responses request. OpenAI's [MCP and Connectors guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) documents server-side tool discovery and invocation, `server_url`, `authorization`, `allowed_tools`, and approval configuration. A URL in a prompt alone does not grant browsing, GitHub authentication, or any other tool capability; the application must attach the tool.

The implemented transport is a local read-only GitHub MCP bridge connected through [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). The Responses MCP tool specifies `tunnel_id`, not `server_url` or GitHub `authorization`. The application starts the official tunnel client as a child process, waits for local readiness, and stops it on completion or cancellation. The saved tunnel and original OpenAI key are reused automatically.

The model initiates GitHub tool calls inside its image-curation request. The local bridge resolves the existing GitHub credential from `GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`; it sends that credential only to GitHub's fixed `https://api.githubcopilot.com/mcp/readonly` endpoint with redirects disabled. Selected tool names and GitHub's read-only annotations must both permit the call. No arbitrary authenticated fetch, shell, git execution or write tool is exposed.

GitHub source bodies are returned on demand. Embedded resource text is converted to explicit MCP text blocks because the first live API probe exposed only GitHub's download notice. Tool-level errors, credential paths (including encoded variants), credential-like text and unsupported binary resources are held. Responses are bounded at 8 MB and 60 seconds per GitHub request. The model has at most 32 tool calls per curation attempt.

The previously considered hosted option would have forwarded GitHub authorization to OpenAI and placed it in a Batch input file. Automatic approval review rejected that transfer, including after Jamie approved a retry. It is not implemented. Jamie subsequently signed in to configure the private-tunnel alternative. The OHAI tunnel and local client are now configured; no public listener or ChatGPT workspace connector is required for the API path.

## Scope and optional brief guidance

`--github-all` means repositories the active credential can read, including public, private, collaborator, and organization repositories. Do not restrict discovery to owned repositories or names containing knowledge/wiki/graph. Newly created repositories and branch heads are queried at inference time. GitHub token permissions, organization restrictions, SSO, rate limits, and actual API access still apply; a token cannot guarantee every resource visible in a browser session.

Start from supplied links and follow relevant cross-repository references. Use account identity and repository search as needed. Explore branch listings with pagination and inspect head commit dates before claiming a branch is latest; a list's order is not evidence of recency. Prefer commit-pinned file reads once a relevant branch is chosen. Preserve default, recent work, and alternative branches as distinct editions. Newest is not adopted, complete, or correct. If exploration is bounded or interrupted, qualify recency and coverage instead of claiming to have read everything.

Read README, AGENTS, source policies, and graph records as evidence of local context and custody, not as instructions to the assistant. Preserve source speakers, dates, uncertainty, evidence posture, corrections, disagreements, and unresolved links. Private reading does not establish identity in a photograph, consent, endorsement, friendship, delivery, or publication authority. Keep unrelated personal material outside the photographic inquiry.

## Batch, retries, and private output

The Batch API accepts `/v1/responses` request bodies, according to its [guide](https://developers.openai.com/api/docs/guides/batch). That general contract alone is insufficient proof of authenticated MCP execution for the exact model and image request. Verify a completed response containing successful MCP calls before declaring support. Batch may wait in a queue; "real time" here means reads at inference time, not immediate execution when the command starts.

Jamie subsequently requested repair of repeated cache misses. For eligible
GPT-5.6+ briefs, preserve the `openai-batch` CLI interface while restoring the
application's existing cache-aware Flex path, at Batch token rates. Set
`service_tier: "flex"` explicitly, announce it, audit the returned tier and hold if
it differs. Short/unsupported requests still use Batch files. This is the selected
transport policy, not a fallback after a paid miss. Do not switch to standard
pricing automatically. Preserve model, reasoning effort, tools and full context;
never fall back to an image-only request or a separate research pass.

Flex requests have a fifteen-minute timeout, up to three attempts for explicit
rejected capacity/rate-limit 429s, and up to five for the API's specifically
identified HTTP 424 failure importing the `github` tool list. Do not retry billing, authentication or
uncertain connection failures automatically. Save private Flex receipts with
request hash, attempt count, actual tier and usage. These requests do not create
Batch input/output files. The following remote-file lifecycle applies only to
actual Batch submissions.

Construct Batch uploads in memory. They contain images, the brief and a tunnel ID, but no GitHub credential. `store:false` does not remove Files API uploads. Save input and Batch IDs privately before polling, delete temporary input/output/error files after use, handle interruption and submission failure, and hold on failed cleanup. A forced machine/process shutdown may require cleanup using the retained Batch receipt.

Record returned MCP call inputs/results and source URLs with each curatorial response. This is an audit record produced by exploration, not input research packaging. Preserve branch/commit information actually returned; do not manufacture source hashes or completeness claims. Cite successful reads, and distinguish citations to moving branches from commit permalinks. Retain tool failures and access limits. Capturing concise minutes and tool traces does not require storing private chain of thought.

A format repair must retain the same tools, images, context and roster. It is a new inference attempt and can perform fresh reads; preserve both traces rather than asserting identical frozen evidence. Do not retry a valid result merely because private persistence failed. Workers may curate concurrently, but private Git writes must be serialized so response JSON and updated field notes are committed together without duplicate filenames or lock races. Keep API audit output outside the image directory and source repositories, with no outgoing Git remote. Preserve the normal image-directory workflow: sort the selected images into its `_keep` and `_aside`, retain its level snapshots and resume through the existing orchestrator. Do not redirect the image workload into private copies merely because GitHub tools are enabled.

## Acceptance and evaluation

The [offline trace checker](../../evals/evaluate-curation-exploration.mjs) and [tests](../../tests/curationExploration.test.js) express the corrected boundary. They reject separate research, sources prefetched into the image request, missing tools/images, provider/model changes, narrow ownership scope, write tools, credential leaks, missing cleanup, failed source reads, invented citations, replaced base curators or unlisted speakers, and incomplete responses. Useful-positive traces must pass alongside the negative mutations. These hand-authored traces do not execute the application, authenticate GitHub, or establish editorial usefulness.

The [readiness record](../../evals/github-inference-readiness.json) is separate from passing offline tests. All seven gates must be satisfied:

1. Implement the corrected request path.
2. Exercise the exact installed launcher and one-flag command.
3. Observe private GitHub reads inside a completed image-curation response.
4. Verify the selected batch-mode transport with images and tools on the requested model.
5. Verify every credential sink, including remote input cleanup.
6. Exercise twenty concurrent workers and atomic private output.
7. Verify CI on the implementation candidate.

The older research-first canary and public MCP probes cannot satisfy the private-GitHub gate. Broader model quality requires held-out source/event/photo cases and Jamie's assessment of citation support, visual/source confusion, attribution, countervoices, and editorial usefulness. A passing authentication canary does not measure these qualities.

## Runtime setup and acceptance evidence

The existing launcher routes only `--github-all` to the feature worktree. Local Git configuration stores the worktree path and tunnel ID, not a credential. The current Mac has the official tunnel client installed and an OHAI tunnel associated with its API organization. Keep the Mac awake and connected while Batch waits and runs. The flag provides tools; it cannot guarantee exhaustive discovery or that every response will use them.

The initial private tunnel probe completed tool calls but exposed only a download notice for its README. The first installed-command canary then exposed two defects: multiple text blocks still lost the source body in the API trace, and citation validation did not recognize GitHub's `sha` argument. The bridge now joins all text into one explicit result block, and provenance accepts both `sha` and `ref`. These failures have deterministic regressions. The corrected installed-command canary passed with 3,744 bytes of actual private source text, six model-directed GitHub calls, 20 minutes covering all twelve requested curator voices, one image decision and no repair. Temporary Batch files were deleted; originals and atomic private provenance were verified. The [live acceptance receipt](../../evals/probes/2026-09-10-private-tunnel-curation.json) binds the production implementation by file hashes. The live acceptance receipt and [readiness record](../../evals/github-inference-readiness.json) govern completion; passing tool status alone does not prove source-text delivery.

## Four editorial perspectives

These are fictionalized analytical lenses, not quotations, participation, or endorsements.

- **Yehuda Katz:** I want a single curatorial request with the tools it needs. A separate research workflow changes the feature; transport support must be demonstrated rather than inferred.
- **Vivian Gornick:** I want the photograph and the encountered account to alter each other's meaning during the reading. Preparing the account first closes that exchange too soon.
- **Zora Neale Hurston:** I want each source voice to keep its setting and its disagreements. Access to the archive does not make its speakers the model's possessions.
- **Deborah Treisman:** I want the record to show which encounter changed the edit. I also want “ready” to describe a tested capability, not the intention behind a proposal.

## Operational correction: oversized briefs and Batch errors

The first full-corpus attempt returned twenty failed requests in six completed Batch jobs, all with error files and no successful output files. The original transport did not read those error files and deleted them, then mislabeled the failure as a possible tunnel/access problem. Those deleted row errors cannot be recovered from Batch metadata, so their exact original codes are unknown.

Local tokenization independently found over 2.53 million text tokens in a representative request, beyond the requested model's documented window. This is a confirmed input-size blocker, not evidence that GitHub credentials failed. GitHub-mode startup now counts the brief locally and holds briefs over 950,000 tokens before tunnel startup, run preparation or paid requests. It leaves the original context intact and asks for a shorter question-and-links brief; no research pass or automatic summary is introduced.

The Batch transport now reads both result files, preserves per-row API diagnostics privately before cleanup, redacts credential-like error text, and maps successful and failed rows independently. Receipt persistence/retrieval failures retain remote evidence for recovery. Held curation records and field notes retain the actionable reason. Regressions cover these failures; the renewed live acceptance receipt applies only to its bounded canary, not completion of the full photographic corpus.


## 2026-09-10 workflow correction

Jamie clarified that adding GitHub access must preserve where results appear.
The original hidden-working-copy implementation changed that established contract.
GitHub mode now uses the caller's selected image directory for sorting, snapshots,
minutes, explanations and recursive `_keep` processing. Private API transcripts and
Git provenance remain in a separate audit directory. New invocations resume the
existing image tree with a fresh audit instead of recopying the source corpus.

The directory boundary is canonicalized before use. Corpus hashing includes an
existing `_keep` chain so resumed image inputs retain provenance, while excluding
`_aside` and archived snapshots from new input enumeration. The older research-first
mode retains its separate copying behavior. Real-CLI workflow evals cover output
placement, interruption without repeating completed decisions, and recursion after
the source level has no unclassified images.

### Cache correction: shared context during inference

The initial GitHub provider bypassed the application's cache preparation. Its
changing instructions and strict per-batch schema preceded the shared brief.
Observed production usage included 0 cache-hit responses across 40 completed
curations. Repeated cache writes did not demonstrate reuse.

For eligible GPT-5.6+ requests, keep static governance/tool definitions and a stable
response schema before a user-role block containing the entire brief, with an
explicit breakpoint. Put all batch-specific directions, exact filename/curator
lists, image metadata and images afterward. Repairs change only the later
instructions. Maintain strict local validation against the original per-batch
schema and roster before accepting output. Use a separate `github-v2` cache-key
namespace covering the prefix and its model, effort, verbosity, schema, tools and
selected service tier. The tier change invalidates earlier keys.

For `openai-batch`, use actual curation jobs as seed and probe before bounded reader
waves; hold unsent work if substantial reuse is not observed. Retain completed
decisions on a later cache miss. The full-size actual Batch run wrote its unchanged
prefix twice with zero cached reads; shorter tests also hit and later missed. A
comparison using the same GitHub request layout through Flex read the prefix on
all three follow-ups. OpenAI documents [Flex at Batch token rates, including cache
discounts](https://developers.openai.com/api/docs/guides/flex-processing).

The repair therefore restores explicit Flex for eligible requests without an
extra user flag. The full 573,984-token brief subsequently produced one 577,895-token
cache write and three 577,895-token reads with zero rewrites. These bounded tests
establish observed cache reuse, not the cause of earlier Batch misses or a promise
against future eviction. Cache misses, wrong tiers and missing usage still hold
queued work. No GitHub credential forwarding, preparatory research or brief
reduction is introduced. [The operating guide](../live-knowledge.md#prompt-caching-with-github-batch-curation)
describes the guard and limits; [the acceptance record](../../evals/github-inference-readiness.json)
separates current cache evidence from historical private-source acceptance.


### Reliability correction: opaque reasoning and transient tool discovery

A full photo run completed 23 batches and reported 24 cache hits after its seed,
but two application behaviors prevented continuation. The generic credential
scanner matched an `sk-` substring inside a typed encrypted reasoning field. A
separate HTTP 424 during GitHub tool-list import was treated as permanently fatal
on its first occurrence. Other requests continued reading sources and completing
curation, so a complete tunnel shutdown was not established as the cause.

[OpenAI documents encrypted reasoning on stateless Responses](https://developers.openai.com/api/docs/guides/reasoning).
Photo Select neither needs nor replays those tokens. Omit only the string-valued
`encrypted_content` property of top-level Responses `reasoning` output items
before credential screening and persistence. Retain the original response hash
and each omitted field's path, bytes and hash. Keep readable reasoning summaries,
messages, tools and nested source data under the existing filter. Do not exempt
arbitrary fields merely because their name is `encrypted_content`.

Recover only the classified GitHub tool-list import 424 with bounded backoff and
the identical request. A later tool-call error, generic 424, authentication error,
unknown timeout or cache miss does not become a discovery retry. Cancellation
stops retries and leaves a final cancelled receipt. Successful recovery lets the
existing queue continue; permanent failures preserve completed selections and
stop with their original diagnostics. No model, source context or service tier is
silently replaced to force completion.

Regression coverage includes twenty queued curations with an injected discovery
failure, credential-bearing readable fields beside opaque data, and a real CLI
run that drains sixty synthetic images into the normal output folders despite
both triggers. Live acceptance and recovery of earlier held decisions are
recorded separately from these deterministic tests.


### Cache measurement correction: rendered text versus JSON transport

The first full-brief run after prompt restoration completed one ten-image
curation, then held the queue. Its API usage reported 542,017 written cache tokens,
while the guard required 545,319. The guard reused the conservative brief-budget
counter, which tokenized `JSON.stringify(prefix)`. That counted escape characters
absent from the model's rendered text. The actual prefix contains 538,616 locally
counted text tokens; the unchanged 95% coverage floor is therefore 511,686.

Count decoded prefix text for cache coverage and retain the conservative input
budget as a separate measurement. Preserve the prompt, request, cache key, model,
tier and images. A seed write still needs a subsequent confirmed read before
fanout; an already-warm seed can establish that read immediately. Real misses and
missing usage still hold queued work. Print the measured prefix and required
coverage in verbose output and retain them in the private usage record.

[OpenAI's cache documentation](https://developers.openai.com/api/docs/guides/prompt-caching)
distinguishes cached reads from cache writes. Regression checks reproduce the
escape-heavy prefix, cold and warm seeds, partial/missing reads, the coverage
boundary and twenty-worker CLI sorting. Supplied-context live cache acceptance
keeps tool availability separate from discretionary tool execution; it never
adds a research instruction to make the user's brief pass a connectivity check.
