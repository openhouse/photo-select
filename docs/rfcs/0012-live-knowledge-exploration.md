# RFC 0012 — Live knowledge exploration with a small application boundary

| Field | Value |
| --- | --- |
| Status | Proposed; offline evals only |
| Decision owner | Jamie Burkart |
| Author | Jamie Burkart with Codex |
| Created | 2026-09-09 |
| Branch | `work/2026-09-09-knowledge` |
| Companion | [RFC 0011: private context and source policy](0011-private-knowledge-context.md) |

## Decision and user experience

Let the model explore authorized GitHub repositories on demand. Jamie supplies a research brief and a private access profile, without preparing a packet first. The model searches, reads a passage, follows a reference, and changes its next question in response. Once research is ready for a curatorial pass, the application records the sources used and supplies that evidence to the existing photo workflow.

This RFC replaces RFC 0011's packet-first rollout sequence for the proposed live mode. Its source authority, attribution, privacy, correction, and publication boundaries still apply. A source receipt is the result of exploration, not a prerequisite for it. This change adds documentation and offline evals only; it enables no live access and changes no application behavior.

Propose one new option, `--knowledge-live <profile.json>`. It does not exist yet. The private profile selects repositories, refs, path scopes, research brief, recipient, purpose, provider/model, limits, and private output root. Existing `--context` remains Jamie's authored brief. The model may follow any authorized repository or document; it need not stay inside a prepared semantic neighborhood. A graph-specific adapter is optional.

## Smallest useful integration

Use one run-scoped research step before `triageDirectory` starts workers or mutates photos. Keep its explicit conversation and tool results separate from the final `minutes` and `decisions`. Freeze its result once for the run, including recursive levels, repair retries, and any field-note pass. Research decisions and concise rationales enter the private audit record; generated curator deliberation remains in `minutes`. No hidden model memory or private chain-of-thought capture is required.

| Proposed location | Bounded change |
| --- | --- |
| `src/index.js` | Load and validate the opt-in profile; run research before triage; reject unsupported combinations before paid requests. |
| New `src/knowledgeResearch.js` | Own a serial model/tool loop, explicit conversation, limits, receipt, and stop/resume state. Reuse SDK configuration and scheduler accounting where practical. |
| New `src/knowledgeGithub.js` | Resolve authorized refs and implement fixed read-only operations. Keep credential handling and network I/O here. Pure scope/receipt rules belong in `src/core/`. |
| `src/templates.js`, message builders, and orchestrator | Pass the same immutable evidence object separately from the authored brief; send source bodies as low-trust data, not interpolated system instructions. Bind its identity to private caches and output records. |

Keep the existing provider choice, model selection, image sampling, filename rules, batching, retries, parser, curator registry, decision schema, and file-move algorithm. Omitting the option must produce the same requests and outputs as today. Do not add reply keys, a database, embeddings, a graph service, a browser, or a hosted broker to deliver the local version. Reject live mode with deferred/batch or unsupported providers initially; never silently disable research or change models.

The current [`chatClient.js`](../../src/chatClient.js) already has Chat Completions and Responses paths. Both assume image curation and extract final text; neither dispatches tool calls. Do not pass research replies through its decision parser or image-response cache. A separate research loop can use supported function calling without migrating the existing curation path. Verify the selected model/endpoint and installed SDK before implementation; do not infer tool support from the current name-based routing. OpenAI documents the request → tool call → tool result → follow-up flow in its [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling).

The narrow tradeoff: research starts from the brief and any explicitly supplied research inputs. A visual discovery during curation can prompt a new research revision and another curatorial pass. Fetching new material halfway through an existing pass is deferred because it would give retries and field-note passes different evidence. The model still chooses its own live searches during research.

## Local authenticated tools

Use the existing authenticated GitHub CLI as the first local credential provider, invoked with fixed executable arguments and GET-only endpoints. Confirm the signed-in account. Intersect its actual access with the explicit profile on every call; a broadly privileged credential does not widen tool permissions. Never expose an arbitrary shell, URL, HTTP method, token, environment dump, or repository-write tool to the model. A scoped read-only token or [GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) can later replace CLI credentials without changing the research contract.

Resolve each selected ref to its full commit at session start. Present the model an authorized catalog with opaque repository IDs, descriptions, and pinned snapshots. Do not silently select `main`, pull another branch, or include uncommitted files. Bind policy and correction revisions to the session. Files cannot grant themselves permissions.

Expose two tools: `knowledge_search(repositoryId, query, cursor)` and `knowledge_read(sourceId)`. Search lists or searches permitted text at the pinned snapshot and returns opaque source IDs, bounded excerpts, and continuation state. An empty query can browse the allowed file tree. An issued source ID is immutable within its session and cannot be rebound to another repository or snapshot. Read accepts an issued ID and resolves its repository, commit, allowed path, and exact body internally. Cross-repository links remain inert text until resolved within the catalog. No new approval is needed for another read inside the authorized scope.

Use ref-specific Git trees and blobs as the correctness path. Search indexes may suggest leads but cannot certify a chosen branch's coverage. Inspect tree entry types before reading; reject symlinks, submodules, traversal, redirects outside the approved API origin, and oversized/binary bodies. GitHub documents [tree truncation and subtree continuation](https://docs.github.com/en/rest/git/trees#get-a-tree) and [content endpoint symlink behavior](https://docs.github.com/en/rest/repos/contents#get-repository-content). Pagination tokens bind the session, repository, snapshot, and query. A truncated response is partial, never complete.

The research loop returns each tool result under its call ID and retains the model outputs required by the selected API. Disable parallel tool calls initially; validate every request even if the model emits several. Count attempts, retries, bytes, tokens, and elapsed time against the same finite limits. Cancellation, denial, missing refs, unsupported data, rate limits, repeated cursors, and exhausted budgets stop further work and preserve a private partial receipt. No photo moves, final decisions, or image-only fallback occur on that failed run. The operator may start an explicit reduced-scope revision.

## Source receipt and private output

Each fetched passage records repository ID, selected ref, full commit, path, byte range, digest, source identity, speaker, evidence posture, retrieval time, policy/correction revision, and qualifications or dissent. Keep the catalog, exact source map, tool inputs/results, selected passages, omissions, and concise research conclusions in a private run root. A citation must resolve to bytes actually read; search snippets and unfetched pointers cannot stand in for a body. Different exports of one account are not independent witnesses.

Distinguish repositories available, queries attempted, files discovered, passages fetched, and evidence selected. Completeness means a named query at a named snapshot completed within the declared scope. It never means the model read everything Jamie knows. Preserve unnamed voices, unresolved links, and contradictory accounts. The frozen context and all dependent cache keys bind the receipt, exact bytes, scope, model/provider, prompt version, and private destination. Bump changed cache prefixes.

Before freezing or resuming, recheck upstream access and policy/correction state. A branch moving later does not mutate a recorded snapshot; refreshing it starts a new revision. Revocation or a changed policy/correction state blocks further use of old results, including response-cache hits. Retained historical records follow their retention policy; revocation cannot promise erasure from an earlier conversation or remote retention.

Source bodies remain untrusted data in tool/data messages. They cannot supply developer instructions, credentials, additional tools, permissions, or curator identities. The opt-in path must satisfy RFC 0011's prompt/roster and private-output prerequisites: fixed fictional curators, no inferred consent or friendship, and private prompts, debug output, caches, minutes, sidecars, field notes, and Git destinations. Use a small mode-specific boundary; keep default behavior unchanged. Do not copy retrieved text into the current system-level `{{context}}` interpolation. If implementation breaks an immutable AGENTS contract, its adoption and versioning requirements still apply.

## Four editorial perspectives

These are fictionalized analytical lenses, not quotations, participation, or endorsements by the named people.

- **Yehuda Katz:** I favor a local read adapter and one explicit research loop. Keep source access replaceable and preserve the existing curation contract.
- **Vivian Gornick:** I want a passage to change the next question. A fixed packet assembled before inquiry would prematurely settle the story.
- **Zora Neale Hurston:** I want the institutional account, the unnamed participant, and Jamie's interpretation to remain distinct. Following a link must not erase its speaker or disagreement.
- **Deborah Treisman:** I want research to change what we notice in an image. Record why an edit changed, and keep the source revision available when we revisit it.

For the DCLA / Brooklyn Arts Council listening-event canary, compare image-only, flat-context, and live-exploration readings of the same small image set. Jamie reviews whether new searches change a selection or interpretation, preserve dissent, and leave uncertain identity uncertain. Context does not prove who appears in a photograph, who spoke at that moment, or who endorses an edit. This public RFC includes no private event evidence.

## Evals, hill climb, and adoption

[`tests/liveExploration.test.js`](../../tests/liveExploration.test.js) exercises an [offline trace checker](../../evals/evaluate-live-exploration.mjs). Useful-positive traces discover an unplanned countervoice in another repository and finish a paginated search. Negative mutations check scope changes, snapshots, tool limits, access failures, citation provenance, attribution, phase identity, instruction boundaries, and premature side effects. RFC 0011's existing tests continue to check exact source bytes and policy-sensitive context identity. Run `npm run evals:knowledge` or `npm run hillclimb` for both sets and their candidate receipt.

These hand-authored traces are design probes. The checker trusts supplied descriptors; it is not an adapter, authentication boundary, model evaluation, or live exploration implementation. Passing says nothing about actual retrieval recall, injection resistance, token accounting, visual understanding, or editorial usefulness. Record observed failures and bounded fixes in the [hill-climb log](../reviews/2026-09-09-knowledge-hillclimb.md); require positive cases alongside hard gates so refusing everything cannot pass.

Before adoption, implement mock GitHub/provider tests for the full request/result loop, query-bound pagination, deadlines and cancellation, SDK compatibility, credential redaction, per-call authorization, immutable source IDs, and off-mode byte parity. Run a separately authorized private canary with canary secrets and injection attempts across every output sink. Jamie labels usefulness, citation support, attribution, visual/context confusion, and missed countervoices; hold out events, source conversations, and photo bursts before tuning. No live-model quality score is claimed here.

Jamie decides the initial scope, provider, budgets, and retention. Roll back by disabling live mode and marking dependent results stale. ChatGPT web access can later use an [authenticated remote Model Context Protocol (MCP) service](https://developers.openai.com/api/docs/guides/developer-mode) over the same tools; local CLI credentials do not connect the web client. That deployment, provider migration, graph indexing, and publication remain separate changes. The local research loop is the proposed first implementation.
