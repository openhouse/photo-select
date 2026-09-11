# Read GitHub during photo curation

Add `--github-all` to your existing command. The curatorial model can follow private repository links, search other accessible repositories, inspect branches and read source text **during the same Responses API call that contains your photographs**. No research pass or source packet runs beforehand.

Your current Mac is configured: the GitHub login and OpenAI key are reused, OpenAI's tunnel client is installed, and the tunnel ID is saved in local Git configuration. The existing launcher routes this flag to `work/2026-09-09-knowledge`.

```sh
PHOTO_SELECT_MAX_OLD_SPACE_MB=32768 \
/Volumes/16TB_SSD/Sites/photo-select/photo-select-here.sh \
  --github-all \
  --provider openai-batch \
  --model gpt-5.6-terra \
  --reasoning-effort high \
  --workers 20 \
  --verbose \
  --curators "Prof. Ingeborg Gerdes, Prof. Margaret Morse, Prof. Warren Sack, Lilli Carré, Jonas Mekas, Zora Neale Hurston, Peter Weibel, Bruno Latour, Ken Burns, Vivian Gornick, MM Bakhtin, Deborah Treisman" \
  --context "/Volumes/16TB_SSD/Photos/2026-04-09/merge-02/NYC Open Data Week 2026/project-overview.txt"
```

Run it from the image directory as before. Put relevant GitHub URLs and the photographic question in your context file. An inline `--knowledge-brief "..."` can supplement or replace that file. Your explicit curator names form the base roster. Without `--curators`, the four default curator names apply. The existing additional-curator feature also works with `--github-all`: Photo Filter tags found in at least two photos **within a batch** append names to that batch's roster. The default identity policy preserves punctuation and excludes placeholder names; the existing canonicalization setting remains available. Each request includes its per-photo tags, and the expanded roster stays the same through any repair. Concurrent batches and later recursive levels compute their own additions.

No extra flag is needed. Keep the configured Photo Filter service available (normally `http://localhost:3000`, configurable with `PHOTO_FILTER_API_BASE`). With `--verbose`, `people-index:` reports metadata preparation and `additional curators from tags:` lists additions when there are any. `--refresh-people-index` refreshes the existing derived index; `--disable-photo-filter` or `PHOTO_SELECT_DISABLE_PEOPLE=1` opts out of people lookups. Missing or unavailable tags cannot add a curator; metadata failures are reported through the existing lookup path.

All voices, including tagged people, are fictionalized lenses. Their generated dialogue is not a quotation or evidence of their actual views. Names encountered in GitHub source text do not automatically become curators. Version 2.0.0 records this user-authorized change to the earlier fixed-roster contract.

## Context size

Use a project question and useful repository links in `--context`, or supply them with `--knowledge-brief`. The file is included in every curation request. A complete multi-megabyte archive export can exceed the model window even though private GitHub access is working.

Before starting the tunnel or preparing the run, `--github-all` counts the JSON-encoded brief locally with the bundled `o200k_base` tokenizer and enforces a 950,000-token brief budget. No counting request sends your text to another API. This leaves 100,000 tokens in [Terra's documented 1,050,000-token window](https://developers.openai.com/api/docs/models/gpt-5.6-terra) for other input, tools and output. It is an application brief limit, not a guarantee that every later response fits; other models can have smaller windows, and tool results also consume context. The application never silently truncates or summarizes your file. A rejected file must be replaced by an explicitly shorter brief or links.

## What the flag does

The launcher starts a private tunnel and a local GitHub read-only bridge. The model chooses tools inside its image-curation request; the bridge performs the requested reads using your GitHub login. Source text returns through the tunnel as tool results. GitHub credentials go only to GitHub, never into the OpenAI request, Batch file, prompt or audit record. The existing OpenAI key authenticates the OpenAI API and tunnel.

The scope is everything the active GitHub credential can read, including public, private, collaborator and organization repositories. Discovery has no fixed repository catalog, owner restriction or knowledge/wiki naming rule. New repositories and branches are available on subsequent tool calls. GitHub API permissions, organization SSO and rate limits still govern access.

The prompt directs the team to follow relevant links, inspect branch heads and commit dates, prefer commit-pinned reads, preserve competing editions and qualify incomplete coverage. This is model-directed exploration, not an exhaustive crawler. A recent branch is not automatically adopted or authoritative. The private trace shows what was actually read.

The bridge exposes only selected read tools that GitHub also marks read-only. It blocks writes, arbitrary URLs/commands, credential-file reads, credential-like output and unsupported binary resources. Embedded text resources are converted to explicit text so the API receives file contents, not merely a download notice. Individual GitHub responses are bounded at 8 MB and 60 seconds; each curation attempt permits up to 32 tool calls.

## Where the edit goes

`--github-all` preserves Photo Select's normal directory workflow. It sorts images
in the directory supplied by `--dir`, or the directory where you invoked
`photo-select-here.sh`. `_keep`, `_aside`, image explanations, minutes and the
`_level-001` snapshot appear there. Recursion continues into `_keep` and writes the
next level's snapshot and result folders in that directory.

Rerun the same command from the same image directory after an interruption. The
existing orchestrator finds the remaining unclassified images, preserves prior
selections and follows the existing `_keep` chain when that level is complete.
It does not repeat completed decisions at the same level. Each invocation gets a
fresh API audit; it does not replay a previous model conversation.

The separate private audit directory is printed at startup. It is on the source
external volume at `/Volumes/<volume>/.photo-select/runs/`, or under
`~/.photo-select/runs/` for other source directories. It contains:

- `session.json` and `corpus.json`: selected directory, base roster, settings and input
  hashes, including images already in the `_keep` chain when resuming.
- `curation-*.json`: requests with each batch roster and photo tags, tool traces, validated replies, source references,
  token usage and repair history.
- `field-notes.md`: the attributed curatorial discussion and decisions.
- `batch-*.json`: Batch/file identifiers, diagnostics and cleanup receipts.
- `runtime.log`: operational output.

Audit files use private filesystem permissions. Each response and updated audit
field notes are committed together in a separate local Git repository with no
remote. Photo Select does not initialize that audit repository in the image
directory. Image sorting and sidecars follow the existing application workflow.
Source access does not establish consent, identity or publication rights.

Earlier GitHub-mode builds incorrectly sorted copies in a hidden private
`images/` directory. Existing edits from those builds should be reconciled against
the source-image hashes before restarting, so completed decisions are preserved
without overwriting changed images or repeating their curation.

## Verbose output

With `--verbose`, curatorial discussion, image decisions and operational logs appear
in the terminal and are also retained in the private run's `runtime.log`. Without
`--verbose`, detailed output stays in that file; startup and final status remain
visible. Verbose output can include private source-derived discussion on your own
terminal.

Earlier builds redirected both stdout and stderr exclusively to `runtime.log`,
even with `--verbose`. If an already-running job shows only the private run path,
open a second terminal and follow its existing log with
`tail -n 80 -f /path/to/run/runtime.log`. Updating the application does not change
a process already running; a restart is not needed to read its log.

## Batch and interruption

Keep this Mac awake, online and attached to the drive until the command finishes. The application keeps the tunnel running while Batch waits and executes, then stops it. Batch may queue work for up to its 24-hour completion window; reads happen when the model runs. `--provider openai` also supports the same tools for synchronous Responses calls. The application never silently changes provider, model or tool availability.

Batch requests are uploaded from memory. Both output and error files are read and matched to their submitted requests. Error diagnostics are saved privately before remote cleanup; terminal messages show error codes and fixed guidance rather than raw API prose. Successful rows survive a different row failing. If result retrieval or diagnostic persistence fails, remote files are retained for recovery. Otherwise the temporary remote input, output and error files are deleted after retrieval; returned traces remain in the private run. Cleanup failures hold the run and leave file IDs in its receipt. Ctrl-C requests Batch cancellation and closes the tunnel. If the process or machine is forcibly killed, inspect `batch-*.json` and the OpenAI Batch dashboard for unfinished jobs/files before retrying. A new invocation resumes the selected image directory with a fresh private API audit; it does not replay the previous model conversation.

A malformed reply gets one repair with the same images, context, tools and roster. The repair can read newer sources; both response traces are retained. Source/tool failures, missing results or persistence errors hold the run. Passing schema and citation checks does not establish editorial quality or citation entailment.

## Held responses and unavailable files

An ordinary GitHub tool lookup error, such as a file absent at the requested commit,
returns an explicit `github_read_unavailable` result to the model. It may try a
verified ref or another path, or state the gap. That result is never accepted as
source evidence. Credential-like content, disallowed operations and transport or
protocol failures still hold the request.

Credential-filter holds now retain a redacted response, the original response hash,
Batch locator and safe trigger metadata (field location, token family, match length
and whether it occurred inside a word). Entire matching strings are omitted,
including private-key bodies. No suspected credential value or excerpt is saved in
those diagnostics. The filter remains enabled. Earlier holds that discarded the
response before auditing cannot be retrospectively diagnosed from that record.

Selections are under `_keep` and `_aside` in the selected image directory, with a text explanation alongside each classified image. See "Where the edit goes" for resuming current runs and reconciling older hidden-copy edits.

## Setup on another machine

This setup is already complete on Jamie's current Mac. For a new installation:

1. Sign in with `gh auth login` and supply the usual `OPENAI_API_KEY` in the environment or original checkout's `.env`.
2. Install the official client: `brew install openai/tools/tunnel-client`.
3. Create a tunnel in [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels) associated with the API key's organization. The runtime principal needs Tunnels Read + Use. Save its ID locally: `git config --local photoSelect.githubTunnelId tunnel_YOUR_ID`.

You can instead set `PHOTO_SELECT_GITHUB_TUNNEL_ID`. The ID is a locator, not a credential. Do not paste a GitHub token into an OpenAI tool authorization field. The application supplies the local bridge command and starts/stops the tunnel automatically. See [OpenAI's tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for organization permissions.

For a development worktree, point the launcher at it with `git config --local photoSelect.knowledgeCheckout /absolute/path/to/worktree`. The configured worktree must remain available. Calls without `--github-all` use the original checkout.

## Verification and the older mode

Run `npm run hillclimb`. The [readiness record](../evals/github-inference-readiness.json) separates live acceptance evidence from offline tests; [the review log](reviews/2026-09-09-knowledge-hillclimb.md) records observed failures and fixes. [RFC 0012](rfcs/0012-live-knowledge-exploration.md) defines the architecture.

The older [`--knowledge-live` mode](research-first-knowledge.md) researches first and passes frozen evidence into a later curation call. It remains available separately and cannot be combined with `--github-all`.
