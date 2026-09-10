# Use live knowledge research

From this worktree, run:

```sh
npm run knowledge -- --dir "/path/to/photos" --knowledge-brief "My DCLA / Brooklyn Arts Council listening-event project"
```

The GitHub CLI uses your existing login. Photo Select uses the existing OpenAI key from your environment or the original checkout's `.env`. The command requires no copied key, prepared packet, or repository list. An existing `--context` file can supplement the inline brief. Your configured model is retained; `--model` can override it explicitly.

## What happens

1. Photo Select creates a private run directory and copies eligible top-level images from the source folder into that run. It preserves the originals. Existing keep/aside subdirectories are not imported into a fresh run.
2. It inventories your owned repositories, including private ones, with complete pagination. Knowledge-related names, topics, descriptions, and explicit inclusions identify the initial catalog. Reading links can add other owned repositories. New unrelated names without these signals may require a `knowledge-wiki` topic or an inclusion entry.
3. It ranks branch heads by commit date, with a stable name tie-break. The newest branch, up to two nearby alternatives, and the default branch remain separate snapshots. The private catalog records every selected full commit and the number of other branches. An explicit branch override takes precedence.
4. The research model searches and reads source passages, follows graph references, and asks further questions. Instructions preserve semantic relationships, evidence, source custody, source voices, corrections, dissent, and uncertainty. Sources remain untrusted data and cannot add tools or grant permissions.
5. The curator team receives the recorded evidence alongside images. Each response must preserve the fixed fictional curator roster, valid source citations, and the exact filename set. A format failure gets one repair using identical evidence.
6. Responses and field notes are committed together in a private local Git repository with no configured remote. The existing photo-selection algorithm operates on the copies.

Runs on an external volume default to `/Volumes/<volume>/.photo-select/runs/`. Other runs use `~/.photo-select/runs/`. The command prints the actual directory. It contains `catalog.json`, `research.json`, `corpus.json`, curation JSON files, `field-notes.md`, a private runtime log, and `images/` with the resulting selections. Private directories use mode 0700. Credentials do not enter the catalog, prompt, or receipt.

The normal application command keeps its existing behavior when live mode is omitted. Live mode currently supports OpenAI through the Responses API and uses the fixed source-aware prompt. Field notes are compiled from validated replies; they do not require another model request. Live responses are not reused from disk caches.

## Inspect discovery or research separately

```sh
node src/index.js --knowledge-discover
npm run knowledge -- --dir "/path/to/photos" --knowledge-brief "Project context" --knowledge-research-only
```

Discovery makes no OpenAI request and copies no images. Research-only mode saves the source record and stops before image curation. These modes still need a readable source directory; it defaults to the current directory.

## Optional private profile

Use `--knowledge-live /private/path/profile.json` when you need exceptions. Keep the profile outside public repositories.

```json
{
  "include": ["your-account/new-research-repo"],
  "exclude": ["your-account/unrelated-private-repo"],
  "branches": {"your-account/new-research-repo": "work/selected-branch"},
  "brief": "The project's research question",
  "runRoot": "/Volumes/YourDrive/private-photo-runs",
  "maxTurns": 16,
  "maxToolCalls": 32,
  "maxTokens": 60000,
  "maxRequests": 2000,
  "maxMilliseconds": 300000
}
```

The automatic scope is the signed-in account's owned repositories. Inclusion does not grant access to another owner's repository. Exclusions apply to both initial discovery and linked repositories. Profile changes hold an active run. A repository can add a `.photo-select-knowledge.json` file at its selected branch root to narrow this access:

```json
{
  "enabled": true,
  "paths": ["wiki/", "docs/", "README.md"],
  "exclude": ["wiki/held/"],
  "purposes": ["photo-reading"],
  "providers": ["openai"],
  "revision": "1"
}
```

`enabled: false` prevents reading that repository's source bodies. Paths are literal files or directory prefixes, not globs. This policy narrows the account/profile scope; it cannot widen it. Other repository-specific source conventions remain attributable source data, not universal permission grants.

## Limits and recovery

Search scans bounded pages of permitted text at pinned commits. The initial reader supports Markdown, text, JSON/JSONL, YAML, CSV, and JavaScript/TypeScript source files up to 64 KB each. It excludes hidden paths, dependency/build directories, common credential paths, symlinks, submodules, binary bodies, and credential-like text. Large graph exports and external custody links can remain unresolved; inspect coverage before interpreting a missing result as absence.

The application stops when a used branch, account, permission, or profile changes; when a tree is truncated; when an explicit source policy denies access; or when a model reply violates the contract. Budgets include model tokens and tool turns; cancellation and deadlines stop further research. A stopped research run retains its partial receipt. Start the same command again to discover a fresh revision. Automatic replay of partial model conversations is deferred.

Private access does not establish consent, identify a photographed person, or authorize publication. Review the source record and the resulting edit before choosing any external audience. Authenticated private reads and a synthetic-data OpenAI canary have been tested separately. A combined private-source-to-OpenAI canary remains awaiting approval of its exact passages; no broad claim of prompt-injection resistance or editorial quality follows from these checks.

Run `npm run hillclimb` for the full offline regression suite and `npm run evals:knowledge` for focused contracts and implementation cases. See [RFC 0012](rfcs/0012-live-knowledge-exploration.md) for architecture and the [hill-climb record](reviews/2026-09-09-knowledge-hillclimb.md) for observed failures and corrections.
