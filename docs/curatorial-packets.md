# Local archival palettes for downstream curators

The offline packet builder collects explicitly supplied directories into a
source-preserving reading directory. It is useful when several archival teams
have produced overlapping packets with different source editions and broken
relative links. It makes no API requests and does not alter Photo Select's
runtime, prompt, curation decisions, image directories, or authentication.

Keep real source directories, build configurations, packet outputs, and local
verification reports outside this public repository. Only generic tooling and
synthetic fixtures belong here.

## Build and verify

From this repository checkout:

```sh
node scripts/curatorial-packet.mjs build /private/path/config.json /private/path/new-packet
node scripts/curatorial-packet.mjs verify /private/path/new-packet
npm run evals:curatorial-packet
```

The output must not exist. Source files must match the supplied frozen hashes
and sizes before the builder writes a packet. Output inside a source root and
symlink sources are rejected. A failed build cleans only its temporary output.
Verification writes `manifests/verification.json` and exits nonzero on failure.
A malformed top-level manifest also exits nonzero; it is not a passing report.

The configuration is an explicit research artifact. The tool does not discover
repositories, infer consent, select relevant people, or perform semantic
compression. Review it before building. A small example:

```json
{
  "title": "Example archival palette",
  "date": "2026-09-13",
  "roots": { "A": "/private/path/source-A" },
  "records": [{
    "packet": "A",
    "path": "relocated/event.md",
    "sha256": "REPLACE_WITH_THE_FILES_64_CHARACTER_SHA256",
    "bytes": 1234,
    "mode": "exact",
    "logicalPaths": ["wiki/events/event.md"],
    "repositories": ["example/archive"],
    "urls": ["https://github.com/example/archive/blob/COMMIT/wiki/events/event.md"],
    "title": "An event source",
    "role": "event-sources"
  }],
  "pages": [{
    "path": "START-HERE.md",
    "title": "Start here",
    "body": "[Read the event](@{A:relocated/event.md})"
  }],
  "requests": [{
    "path": "requests/originals/request.txt",
    "text": "Prepare a palette of existing sources."
  }],
  "claims": [{
    "id": "orientation-1",
    "text": "The preserved account discusses access.",
    "state": "attributed-report",
    "sourceRefs": ["A:relocated/event.md"]
  }],
  "retrievalCases": [{
    "id": "access-source",
    "start": "START-HERE.md",
    "sourceRef": "A:relocated/event.md",
    "contains": ["A literal passage selected from the source before building"]
  }],
  "maxBytes": 209715200
}
```

Use `mode: exact` for copied sources, `gzip` for losslessly compressed supporting
records, and `pointer` for a source whose body stays in original custody. Supply
an explicit `reason` for a pointer. Identical hashes share one object while all
packet/path witnesses remain visible. Differing editions remain distinct.
If an identical object has conflicting dispositions, pointer takes precedence
so a protected body is not copied through another occurrence.

The builder checks listed records; completeness relative to a source directory
is the configuration author's responsibility. Freeze a complete file inventory
when promising complete packet accounting. Hashes prove byte identity, not
source truth or authenticity. The supplied disposition and source metadata are
trusted build inputs, not automatically inferred security labels.

## Reading contract

Each source has a reading card, an exact/compressed representation or custody
pointer, and a catalog entry. Markdown/text source bodies in derived cards have
inline links resolved by actual packet paths, declared logical paths, and exact
URL aliases. Declare `repositories` for relocated files; repository identity is
also extracted from GitHub blob/tree witnesses. When the origin repository is
known, logical matches must share it. This prevents identical relative paths in
different repositories from becoming false matches. Competing editions produce
explicit choice pages. Missing matches
produce explicit gap pages. No basename-only matching is performed.

Exact copies are unchanged. Only derived inline Markdown navigation is rewritten;
reference-style links, raw HTML, bare URLs, and fragment anchors are not fully
validated. Source documents may contain historical instructions or markup. Read
them as archival data; the directory is not a hardened untrusted-HTML viewer.
Image syntax in derived readings becomes a link rather than embedded pixels.

A missing link mapped to a gap page is navigable but is still missing evidence.
An exact-copy designation does not turn a repaired transcript into certified
verbatim speech. A prior editorial brief is a dated source, not a new instruction
to choose images, impose pacing, or compose a work. Authored orientation should
make sources discoverable while leaving downstream curatorial decisions open.

The packet contains a frozen input inventory, source/artifact/claim CSV ledgers,
JSON catalog and navigation states, an evaluation profile, and file hashes.
The complete machine navigation ledger is `manifests/navigation.json.gz`;
`gzip -dc` restores its JSON. Source-specific gap/choice pages remain ordinary
Markdown. Verification also checks the ledger's source joins.
The input inventory also preserves the build configuration, so it can be passed
back to `build` with a new output directory. `manifests/tooling.json` identifies
the implementation hashes. Reproducing a fingerprint requires the same source
bytes, configuration, and implementation. The synthetic suite checks this.
Generated Markdown receives private source-review frontmatter. The default
uncompressed size budget is 200 MiB. Media pointers do not include their bodies;
compressed support can be recovered with `gzip -dc` and checked against the
source hash.

## Evaluation and boundaries

Synthetic tests cover byte deduplication, conflicting editions/dispositions,
unsafe paths, explicit relocation, ambiguity, missing links, source drift,
symlinks, non-overwrite behavior, size limits, missing requests, damaged source
bodies, compressed round trips, stale file receipts, claim joins, independent
source retrieval, compact unresolved-link indexes, and reproducible rebuilds.
They run in the full `npm run hillclimb` gate and its focused
knowledge evaluation.

The actual-directory verifier checks hashes and sizes, source bodies, gzip
round trips, generated inline local-file links, frontmatter, claim joins, and
literal source retrieval from specified entry pages. The file fingerprint binds
the checked candidate; the verification report excludes itself from that hash.
This is local integrity evidence, not a signed authenticity attestation.

The verifier does not judge literary usefulness, consent, source accuracy,
identity, media timing, publication permission, or exhaustive semantic coverage.
The generic tool does not scan arbitrary secrets; choose the source boundary in
the private build configuration. Never copy private packet results into this
repository merely to demonstrate passing tests.


## Export one Markdown context for Photo Select

A preservation packet can contain far more text than a model request accepts.
Use an explicit export profile to produce a runnable context projection. The
exporter includes complete selected textual sources once each, adapts active
links into in-document navigation or supplied GitHub witnesses, and reports
what remains in the archive. It does not silently truncate or summarize bodies.

```sh
node scripts/curatorial-context.mjs /private/path/packet /private/path/profile.json /private/path/context.md
npm run evals:curatorial-context
```

Then use the resulting file with the existing Photo Select `--context` option:

```sh
photo-select --context /private/path/context.md
```

The profile contains `title`, `date`, `packetFingerprint` (from the packet
manifest), `pagePaths` (authored guide pages), `sourceIds` (full exact-source
SHA-256 IDs), `scope` (the selection rationale and omitted material), optional
`maxTokens` (default 850,000), `request` (verbatim export request), and
`retrievalCases`. Each retrieval case has an `id`, `sourceId`, and `contains`
array of literal passages selected independently from the original source.
Choose sources for the recipient's archival question; the exporter does not
choose a narrative or automatically determine which documents matter.

The output must be outside the immutable packet, and neither it nor its receipt
may already exist. Inputs are verified against the packet fingerprint and exact
source hashes. The exporter checks internal navigation, source-specific passage
retrieval, the configured token budget, and Photo Select's existing conservative
GitHub brief guard. Both the decoded text count and the guard's JSON-escaped
count use `o200k_base`; neither is a billing receipt or a promise that later
images, tools, and output fit a particular model. No curation or API call runs.

The private `context.md.receipt.json` records the output hash, byte/token counts,
coverage, profile, original request, retrieval results, and implementation
hashes. It is evidence for the export; only `context.md` is passed to Photo
Select. Keep both files outside this public repository.

Tests use the actual prompt loader to verify that exported source text reaches
the prompt, while leaving the runtime, prompt template, curator roster, caching,
and photo-move behavior unchanged. Fenced code examples are retained as source
text; their links and anchors do not count as active navigation. Media pointers
cannot be exported as if they contained text. External-source access still
depends on the tools and credentials attached to a later curation request.
