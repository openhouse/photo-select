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

Run it from the image directory as before. Put relevant GitHub URLs and the photographic question in your context file. An inline `--knowledge-brief "..."` can supplement or replace that file. Your explicit curator names remain fixed throughout the session and repairs. Without `--curators`, the four default curator names apply. All voices are fictionalized lenses.

## Context size

Use a project question and useful repository links in `--context`, or supply them with `--knowledge-brief`. The file is included in every curation request. A complete multi-megabyte archive export can exceed the model window even though private GitHub access is working.

Before starting the tunnel or copying images, `--github-all` counts the JSON-encoded brief locally with the bundled `o200k_base` tokenizer and enforces a 950,000-token brief budget. No counting request sends your text to another API. This leaves 100,000 tokens in [Terra's documented 1,050,000-token window](https://developers.openai.com/api/docs/models/gpt-5.6-terra) for other input, tools and output. It is an application brief limit, not a guarantee that every later response fits; other models can have smaller windows, and tool results also consume context. The application never silently truncates or summarizes your file. A rejected file must be replaced by an explicitly shorter brief or links.

## What the flag does

The launcher starts a private tunnel and a local GitHub read-only bridge. The model chooses tools inside its image-curation request; the bridge performs the requested reads using your GitHub login. Source text returns through the tunnel as tool results. GitHub credentials go only to GitHub, never into the OpenAI request, Batch file, prompt or audit record. The existing OpenAI key authenticates the OpenAI API and tunnel.

The scope is everything the active GitHub credential can read, including public, private, collaborator and organization repositories. Discovery has no fixed repository catalog, owner restriction or knowledge/wiki naming rule. New repositories and branches are available on subsequent tool calls. GitHub API permissions, organization SSO and rate limits still govern access.

The prompt directs the team to follow relevant links, inspect branch heads and commit dates, prefer commit-pinned reads, preserve competing editions and qualify incomplete coverage. This is model-directed exploration, not an exhaustive crawler. A recent branch is not automatically adopted or authoritative. The private trace shows what was actually read.

The bridge exposes only selected read tools that GitHub also marks read-only. It blocks writes, arbitrary URLs/commands, credential-file reads, credential-like output and unsupported binary resources. Embedded text resources are converted to explicit text so the API receives file contents, not merely a download notice. Individual GitHub responses are bounded at 8 MB and 60 seconds; each curation attempt permits up to 32 tool calls.

## Where the edit goes

Photo Select copies supported top-level images to a new private run and performs the usual selection algorithm there. Originals remain in place. Existing keep/aside subdirectories are not imported into a fresh run.

The printed run path is on the source external volume at `/Volumes/<volume>/.photo-select/runs/`, or under `~/.photo-select/runs/` for other source directories. It contains:

- `images/`: working copies and the resulting selections.
- `session.json` and `corpus.json`: mode, roster, source-image hashes and settings.
- `curation-*.json`: exact requests, returned tool traces, validated replies, source refs, token usage and repair history.
- `field-notes.md`: the attributed curatorial discussion and decisions.
- `batch-*.json`: remote Batch/file IDs, status, credential-screened API diagnostics and cleanup receipts.
- `runtime.log`: private operational output.

The run uses private filesystem permissions. Each response and updated field notes are committed together in a local Git repository with no remote; concurrent workers serialize those commits. The application does not publish the output. Source access does not establish consent, identity or publication rights.

## Batch and interruption

Keep this Mac awake, online and attached to the drive until the command finishes. The application keeps the tunnel running while Batch waits and executes, then stops it. Batch may queue work for up to its 24-hour completion window; reads happen when the model runs. `--provider openai` also supports the same tools for synchronous Responses calls. The application never silently changes provider, model or tool availability.

Batch requests are uploaded from memory. Both output and error files are read and matched to their submitted requests. Error diagnostics are saved privately before remote cleanup; terminal messages show error codes and fixed guidance rather than raw API prose. Successful rows survive a different row failing. If result retrieval or diagnostic persistence fails, remote files are retained for recovery. Otherwise the temporary remote input, output and error files are deleted after retrieval; returned traces remain in the private run. Cleanup failures hold the run and leave file IDs in its receipt. Ctrl-C requests Batch cancellation and closes the tunnel. If the process or machine is forcibly killed, inspect `batch-*.json` and the OpenAI Batch dashboard for unfinished jobs/files before retrying. A new invocation starts a fresh private edit rather than replaying a partial conversation.

A malformed reply gets one repair with the same images, context, tools and roster. The repair can read newer sources; both response traces are retained. Source/tool failures, missing results or persistence errors hold the run. Passing schema and citation checks does not establish editorial quality or citation entailment.

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
