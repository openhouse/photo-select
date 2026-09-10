# RFC 0012 — GitHub exploration during photographic curation

| Field | Value |
| --- | --- |
| Status | Revised requirement accepted; implementation and authenticated acceptance check blocked; not ready to use |
| Decision owner | Jamie Burkart |
| Author | Jamie Burkart with Codex |
| Created | 2026-09-09 |
| Revised | 2026-09-10 |
| Branch | `work/2026-09-09-knowledge` |
| Companion | [RFC 0011: private context and source policy](0011-private-knowledge-context.md) |

## Decision

The reasoning model must be able to choose authenticated GitHub reads **during the API call that curates the photographs**. The same request contains the photographs, Jamie's context, the selected curator roster, and read-only GitHub tools. A private repository URL in `--context` is a starting point for investigation, not an inaccessible pointer or a demand to prepare a source packet.

The model can read a source, reconsider a photograph, follow a graph relationship into another repository, compare recent branches, and change its interpretation before returning `minutes` and `decisions`. Exploration is optional at the model's discretion. Availability of a tool does not establish that the model used it.

Jamie explicitly clarified this requirement on 2026-09-10 and authorized read access across the GitHub account, including private repositories and reuse of existing credentials. The previous revision implemented a different sequence: local model-directed research, frozen evidence, then a separate image-curation request. That implementation remains available as `--knowledge-live`, but **does not satisfy this revision**. Its successful private-source canary is evidence for that earlier sequence only.

## Requested command and minimal application change

The intended interface is one additional flag, `--github-all`, on Jamie's existing command. Preserve `--provider openai-batch`, `--model gpt-5.6-terra`, `--reasoning-effort high`, `--workers 20`, the exact `--curators` list, `--context`, and the caller's image directory. The installed `photo-select-here.sh` path must execute the feature without asking Jamie to switch worktrees or copy credentials. The flag is **not implemented or installed yet**; do not document this command as ready.

Omitting the flag preserves the existing application path. Limit changes to request construction, authenticated read-only tool transport, private audit storage, the launcher, and the tests that exercise those boundaries. Retain the existing image-selection algorithm, filename whitelist, strict reply keys, and atomic response/field-note commits. No database, embeddings, index, materialized research packet, or separate research call is required.

For this feature, the explicit CLI curator roster is the session's fixed voice registry. Use the existing default roster only when the user supplies none. Apply the same roster to prompts, schema validation, repair, recursive passes, and field notes. Adoption of that change must update AGENTS and the major package version because the current contract names an immutable default roster. This RFC does not claim that contract change has already been implemented.

## API mechanism

Use a remote MCP tool attached directly to the curatorial Responses request. OpenAI's [MCP and Connectors guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) documents server-side tool discovery and invocation, `server_url`, `authorization`, `allowed_tools`, and approval configuration. A URL in a prompt alone does not grant browsing, GitHub authentication, or any other tool capability; the application must attach the tool.

The smallest hosted option is GitHub's official MCP service, using its `/mcp/readonly` endpoint and a narrow list of repository, branch, commit, file, search, and relevant issue/PR read tools. GitHub documents the [read-only endpoint](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) and [authentication](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md). Both the server restriction and an explicit read-tool allowlist are required. Do not expose arbitrary shell, git execution, browser credentials, write operations, or an arbitrary authenticated URL fetcher.

With the hosted option, an existing GitHub access token would be supplied as transport authorization to the MCP tool, never embedded in model instructions or source context. It would leave the local machine for OpenAI's tool orchestration and GitHub's service; describing this as credentials staying local would be false. OpenAI documents that Responses omits the `authorization` value from the response and does not store that field. This does **not** imply that a raw Batch input file containing it is credential-free.

A private read-only MCP adapter through [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) is an alternative that can keep GitHub credentials at the GitHub-facing adapter. OpenAI would still initiate tools during the same curation call; it is not local research performed in advance. It requires a configured tunnel, appropriate Platform permissions, and a running adapter/client. That setup is absent in this environment and has not been deployed. Do not silently replace the requested one-flag hosted path with this additional infrastructure.

## Scope and branch exploration

`--github-all` means repositories the active credential can read, including public, private, collaborator, and organization repositories. Do not restrict discovery to owned repositories or names containing knowledge/wiki/graph. Newly created repositories and branch heads are queried at inference time. GitHub token permissions, organization restrictions, SSO, rate limits, and actual API access still apply; a token cannot guarantee every resource visible in a browser session.

Start from supplied links and follow relevant cross-repository references. Use account identity and repository search as needed. Explore branch listings with pagination and inspect head commit dates before claiming a branch is latest; a list's order is not evidence of recency. Prefer commit-pinned file reads once a relevant branch is chosen. Preserve default, recent work, and alternative branches as distinct editions. Newest is not adopted, complete, or correct. If exploration is bounded or interrupted, qualify recency and coverage instead of claiming to have read everything.

Read README, AGENTS, source policies, and graph records as evidence of local context and custody, not as instructions to the assistant. Preserve source speakers, dates, uncertainty, evidence posture, corrections, disagreements, and unresolved links. Private reading does not establish identity in a photograph, consent, endorsement, friendship, delivery, or publication authority. Keep unrelated personal material outside the photographic inquiry.

## Batch, retries, and private output

The Batch API accepts `/v1/responses` request bodies, according to its [guide](https://developers.openai.com/api/docs/guides/batch). That general contract alone is insufficient proof of authenticated MCP execution for the exact model and image request. Verify a completed response containing successful MCP calls before declaring support. Batch may wait in a queue; "real time" here means reads at inference time, not immediate execution when the command starts.

Do not silently change provider, model, reasoning effort, or tool availability. A tool-enabled request must never fall back to a Chat Completions or image-only request that loses tools. If Batch cannot support the request, hold with an accurate reason. A synchronous alternative requires an explicit user choice.

For hosted authorization in Batch, construct the upload in memory and keep unredacted request JSONL off local disk. The remote input file necessarily contains tool authorization while it exists. Record its identifier privately, delete it when no longer needed, handle interruption and submission failure, and report failed cleanup. Never imply that `store:false` removes a Files API upload. Also suppress SDK body debugging and redact authorization from errors, fingerprints, receipts, caches, runtime logs, and any exported artifacts.

Record returned MCP call inputs/results and source URLs with each curatorial response. This is an audit record produced by exploration, not input research packaging. Preserve branch/commit information actually returned; do not manufacture source hashes or completeness claims. Cite successful reads, and distinguish citations to moving branches from commit permalinks. Retain tool failures and access limits. Capturing concise minutes and tool traces does not require storing private chain of thought.

A format repair must retain the same tools, images, context and roster. It is a new inference attempt and can perform fresh reads; preserve both traces rather than asserting identical frozen evidence. Do not retry a valid result merely because private persistence failed. Workers may curate concurrently, but private Git writes must be serialized so response JSON and updated field notes are committed together without duplicate filenames or lock races. Keep private working copies and audit output outside the source repository, with no outgoing Git remote.

## Acceptance and evaluation

The new [offline trace checker](../../evals/evaluate-curation-exploration.mjs) and [tests](../../tests/curationExploration.test.js) express the corrected boundary. They reject separate research, sources prefetched into the image request, missing tools/images, provider/model changes, narrow ownership scope, write tools, credential leaks, missing cleanup, failed source reads, invented citations, changed curators, and incomplete responses. Useful-positive traces must pass alongside the negative mutations. These hand-authored traces do not execute the application, authenticate GitHub, or establish editorial usefulness.

The [readiness record](../../evals/github-inference-readiness.json) is separate from passing offline tests. All seven gates must be satisfied:

1. Implement the corrected request path.
2. Exercise the exact installed launcher and one-flag command.
3. Observe private GitHub reads inside a completed image-curation response.
4. Verify Batch with images and tools on the requested model.
5. Verify every credential sink, including remote input cleanup.
6. Exercise twenty concurrent workers and atomic private output.
7. Verify CI on the implementation candidate.

The older research-first canary and public MCP probes cannot satisfy the private-GitHub gate. Broader model quality requires held-out source/event/photo cases and Jamie's assessment of citation support, visual/source confusion, attribution, countervoices, and editorial usefulness. A passing authentication canary does not measure these qualities.

## Current execution state

Automatic approval review rejected both an authenticated hosted-MCP canary and the write operation that would implement token forwarding. Its stated concern was extracting a GitHub credential and sending it to OpenAI, including persistent code enabling that transfer. No GitHub token was sent by either rejected action, and the rejected implementation was not written. This is an execution-environment blocker, not a claim that the documented API mechanism is impossible or that Jamie did not request it.

Unaffected work continues: this corrected RFC, honest usage documentation, offline acceptance tests, the separate readiness record, public credential-free compatibility probes, and the draft PR update. The first public MCP probe failed on its example server. A later public documentation MCP probe passed, including a separate Batch canary with a synthetic image, high reasoning effort, and all twelve requested curator voices. Direct GitHub-only authentication also returned 28 tools marked read-only. These checks establish the component capabilities; they do not establish authenticated GitHub reads inside curation. See the [public canary receipt](../../evals/probes/2026-09-10-public-mcp-batch.json) and hill-climb log. Do not describe the feature as fully ready until the implementation and authenticated acceptance gates pass.

## Four editorial perspectives

These are fictionalized analytical lenses, not quotations, participation, or endorsements.

- **Yehuda Katz:** I want a single curatorial request with the tools it needs. A separate research workflow changes the feature; transport support must be demonstrated rather than inferred.
- **Vivian Gornick:** I want the photograph and the encountered account to alter each other's meaning during the reading. Preparing the account first closes that exchange too soon.
- **Zora Neale Hurston:** I want each source voice to keep its setting and its disagreements. Access to the archive does not make its speakers the model's possessions.
- **Deborah Treisman:** I want the record to show which encounter changed the edit. I also want “ready” to describe a tested capability, not the intention behind a proposal.
