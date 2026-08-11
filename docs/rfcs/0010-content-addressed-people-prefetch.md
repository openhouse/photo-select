# RFC 0010 — Content-Addressed People Prefetch

| Field | Value |
| --- | --- |
| **Status** | **Draft** |
| **Audience** | Photo Select and Photo Filter contributors |
| **Author** | Jamie Burkart with collaborators |
| **Created** | 2026-08-11 |
| **Companion** | `openhouse/photo-filter` RFC 0008 |

---

## 1 — Summary

Before Photo Select prepares model prompts for a level, resolve that level's
people metadata through Photo Filter's content-addressed bulk API. Populate the
existing in-process people cache from one verified corpus snapshot, then let
the established prompt path proceed unchanged.

This is a performance repair, not a curatorial-policy change. The CLI,
filenames, prompt wording, context brief, person ordering, repeated-person
curator additions, decisions, resume behavior, and output artifacts remain the
same.

## 2 — Motivation

The current client asks Photo Filter for people one filename at a time. Photo
Filter cold-scans an album's `photos.json` for each request and serializes those
scans. Large levels can therefore spend tens of minutes collecting people tags
before the first model request is submitted.

People enrichment is part of the work's relational intelligence: if the same
person appears in multiple photographs, that person's lens joins the
curatorial comparison. Removing or sampling enrichment would make the tool
faster by changing what it means. This RFC instead removes repeated work.

## 3 — Companion contract

Photo Filter RFC 0008 defines a derived people index identified by the SHA-256
of every active canonical `photos.json` source. Its API keeps two freshness
claims separate:

1. **Index freshness:** the index exactly represents that `photos.json`
   corpus.
2. **Source freshness:** that corpus reflects the current Apple Photos
   library.

Photo Select may rely on the first claim when the corpus hash is verified. It
must display `sourceFreshness: "unknown"` when no upstream export revision can
prove the second claim. A verified cache must not imply more than it proves.

## 4 — Level prefetch

For every recursively selected level:

1. collect its eligible filenames in deterministic order;
2. partition them into requests of at most 500 filenames;
3. send the first chunk with `refresh: "verify"` (or `"force"` when explicitly
   requested);
4. send every later chunk with the first response's
   `expectedCorpusSha256` and `refresh: "snapshot"`;
5. reject a hash mismatch rather than mix people metadata from two corpus
   revisions;
6. populate the existing `peopleCache` only after all chunks validate;
7. run the existing prompt preparation and provider workflow.

The prefetch is once per level, not once per batch. Duplicate filenames are
deduplicated for transport but retain their original level behavior.

## 5 — Compatibility and fallback

Capability detection is intentionally conservative:

- A successful bulk response primes the existing cache.
- `404` or `405` means the connected Photo Filter predates RFC 0008. Photo
  Select records that fact and falls back to the existing lazy, per-filename
  endpoint.
- A malformed response, corpus mismatch, or server error is surfaced. It does
  not become a cache of empty people arrays.
- Legacy fallback is lazy; Photo Select does not launch an unbounded fan-out of
  old single-filename calls merely because bulk support is absent.

Omitting the new refresh option preserves current CLI behavior. An explicit
`--refresh-people-index` option (and corresponding environment variable) asks
the first level request to force a rebuild. It does not mutate photographs or
the Apple Photos library.

## 6 — Prompt and cache invariants

The bulk path returns the same ordered people arrays as the legacy endpoint.
Therefore it does not:

- truncate or rewrite `--context`;
- change prompt templates or message ordering;
- change filename whitelists;
- change how a person appearing in more than one photo is added to the
  curators;
- change model, reasoning effort, batching, recursion, or stopping rules.

The provider prompt-cache key is not bumped merely because people metadata was
transported in bulk. If a verified refresh reveals genuinely changed people
metadata, the resulting prompt content and request identity change naturally.

## 7 — Observability

Verbose output reports one compact line per level:

```text
people-index: status=verified corpus=<12-char-prefix> sources=42 names=13167 elapsed=1.8s source_freshness=unknown
```

Track:

- `people_prefetch_ms`
- `people_prefetch_names`
- `people_prefetch_chunks`
- `people_prefetch_cache_hits`
- `people_prefetch_fallbacks`
- `people_corpus_sha256`
- `people_source_freshness`

Private filenames and person names are not logged by default.

## 8 — Evaluation plan

Code-based evals must establish:

1. 1,001 filenames produce chunk sizes `500`, `500`, and `1`.
2. Every chunk after the first is pinned to the same corpus hash.
3. A hash mismatch or malformed response commits no partial cache entries.
4. A bulk `404` preserves the current legacy request path.
5. Bulk and legacy paths serialize byte-identical people metadata into prompt
   inputs for exact, semantic-alias, missing, and ambiguous fixtures.
6. Two photographs containing the same person still add that person to the
   curators under the existing rule.
7. Context bytes and prompt-template bytes are identical before and after the
   transport change.
8. An end-to-end fixture replaces hundreds of source scans with one verified
   index build while preserving decisions.

## 9 — Rollout

1. Land the companion Photo Filter bulk endpoint and parity evals.
2. Land level prefetch with legacy fallback disabled only in its focused eval.
3. Run both paths against the same representative local corpus and compare
   normalized prompt inputs.
4. Measure cold and warm latency, scan count, and corpus identity.
5. Keep the legacy endpoint until deployed clients demonstrate parity.

## 10 — Alternatives rejected

- **Increase workers only:** the server's per-album lock still serializes cold
  scans and risks resource pressure.
- **Sample or cap people tags:** faster, but changes the curatorial team.
- **Cache forever by filename:** cannot prove which export revision supplied a
  result.
- **Hash only requested filenames:** misses additions, deletions, and changes
  elsewhere in active metadata sources.
- **Assume index freshness proves Apple Photos freshness:** confuses two
  different provenance boundaries.

## 11 — Open question

When the export layer can expose a durable Apple Photos revision, should Photo
Select offer a strict mode that refuses to begin a paid model run unless both
index freshness and source freshness are proven?
