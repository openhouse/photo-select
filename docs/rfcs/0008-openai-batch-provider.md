# RFC 0008 — OpenAI Batch Provider (MVP)

**Status:** Proposed  
**Authors:** Jamie Burkart et al.  
**Reviewers:** Matteo Collina, Simon Willison, Evgeny Poberezkin, James M. Snell, Logan Kilpatrick, Yehuda Katz, Erik Bernhardsson, Deborah Treisman  
**Created:** 2025‑10‑18  
**Target Version:** v0.2.x

## 0. Summary

Add a new provider, **`openai-batch`**, that runs each *curatorial session* as a single **OpenAI Batch API** job. 
We preserve all current invariants of `photo-select`: one session per recursion level, the same *minutes + decisions* artifacts, and identical on‑disk choreography (`_keep` / `_aside`, then descend).  
Users can hot‑switch gears between realtime (`openai`) and batch (`openai-batch`), “taste the soup” with read‑only probe minutes, and pause/resume safely thanks to per‑level durable state.

**Why Batch:**  
- ~**50% lower cost** than synchronous APIs, per OpenAI pricing/FAQ. :contentReference[oaicite:3]{index=3}  
- **Asynchronous** processing with a **24‑hour target window**; **no streaming**; **images supported**; **separate rate limits**. :contentReference[oaicite:4]{index=4}  
- JSONL input format: one object per request with `custom_id`, `method`, `url`, `body`. :contentReference[oaicite:5]{index=5}

> **Non‑negotiable invariant:** *One session = one call*. In batch mode this becomes *one batch job with exactly one JSONL line*. This avoids request‑size surprises and keeps mental models stable.

> **Repository context:** We already have providers for OpenAI and Ollama; this RFC adds a third, `openai-batch`, without changing file choreography. :contentReference[oaicite:6]{index=6}

---

## 1. Goals

1. **Drop‑in parity**  
   For a given session input, batch mode yields the same shape of outputs (minutes + decisions) and triggers the same file moves as realtime.

2. **Switchable gears**  
   A control file `./.photo-select/gear.json` (`{"provider":"openai-batch"}` or `"openai"`) is read when a session is created. In‑flight sessions finish on their original provider.

3. **Taste the soup**  
   A probe command (`photo-select probe --n <int>`) runs a *realtime*, read‑only “tasting” at the current level that writes `probe-minutes.md` and `probe-decisions.json` without moving files.

4. **Per‑level durability**  
   Persist a small ledger next to artifacts (tickets + optional SQLite) so runs survive crashes and tolerate user edits between passes.

5. **Model parity with GPT‑5**  
   MVP targets **GPT‑5** through the **Responses API**; we fall back to Chat Completions when the Batch endpoint/model combination doesn’t support `/v1/responses`. :contentReference[oaicite:7]{index=7}

---

## 2. Non‑Goals

- Streaming or partial result application (Batch doesn’t stream). :contentReference[oaicite:8]{index=8}  
- Packing multiple sessions into one batch job (we intentionally keep one line per job).  
- Changing curator personas, selection logic, or minutes/decisions schema.

---

## 3. User context: story → curation → resonance

The practice begins with 2k–10k images and a rich context file (site copy, emails, calendar, voice memos) collapsed into a single text. Each session convenes a panel of curators, produces *minutes* and a strict JSON *decisions* block, moves photos into `_keep` or `_aside`, and recurses. Batch mode should *not* change the editorial stance or the location of artifacts; it only changes *when* results land and how much they cost.

---

## 4. Platform constraints (OpenAI)

- **JSONL format**: Each request line must include `custom_id`, `method`, `url`, `body`. :contentReference[oaicite:9]{index=9}  
- **Window & pricing**: 24‑hour completion target; ~50% cost reduction vs. synchronous APIs. :contentReference[oaicite:10]{index=10}  
- **Capabilities**: No streaming; images supported; separate rate limits; zero‑data‑retention is not supported on Batch. Document this clearly in README. :contentReference[oaicite:11]{index=11}

---

## 5. Design

### 5.1 Provider interface

```ts
// src/providers/types.d.ts
export interface CuratorialProvider {
  name: string; // 'openai' | 'ollama' | 'openai-batch'
  submit(session: SessionInput, opts: ProviderOpts): Promise<SessionHandle>;
  collect(handle: SessionHandle): Promise<SessionResult>; // resolves to the same structures used today
  cancel?(handle: SessionHandle): Promise<void>;
  // For realtime providers, submit() may internally execute and return an already-completed handle.
}
````

The orchestrator treats providers uniformly: create sessions, then `collect()` results. Realtime resolves immediately; batch resolves when a job finishes. No change to recursion/file‑move logic.

### 5.2 One session = one batch job

For each session we write a **single‑line JSONL** file:

```json
{
  "custom_id": "ps:<level-path>|sha256:<inputs>",
  "method": "POST",
  "url": "/v1/responses",
  "body": {
    "model": "gpt-5",
    "reasoning": { "effort": "medium" },
    "text": {
      "verbosity": "low",
      "format": {
        "type": "json_schema",
        "name": "PhotoSelectPanelV1",
        "strict": true,
        "schema": { /* unchanged schema */ }
      }
    },
    "input": [
      { "role": "user", "content": [
        { "type": "input_text", "text": "Context ..." },
        { "type": "input_text", "text": "{\"filename\":\"DSCF0001.jpg\",\"people\":[\"Alice\",\"Bob\"]}" },
        { "type": "input_image", "image_url": { "url": "data:image/jpeg;base64,..." } }
        /* up to N images, 1600px proxies */
      ]}
    ]
  }
}
```

We upload it via the **Files API** with `purpose:"batch"`, then create the job with `endpoint:"/v1/responses"` (or `/v1/chat/completions` if capability check fails) and `completion_window:"24h"`. We poll until *completed*, download `output_file_id`, parse the JSONL, match by `custom_id`, and hand the assistant’s structured JSON to the existing parser/mover logic. ([OpenAI Cookbook][3])

> **Note**: For some releases, examples and guides use `/v1/chat/completions` in batch; we support both endpoints with an automatic fallback check. ([OpenAI Cookbook][3])

### 5.3 Filesystem choreography (unchanged)

Within the current recursion level directory:

```
<level-dir>/
  minutes-*.json                # final minutes (unchanged)
  decisions.json                # final decisions (unchanged)
  _keep/  _aside/               # file moves (unchanged)
  .photo-select/
    gear.json                   # {"provider":"openai-batch"|"openai"}
    state.db                    # optional SQLite (see 5.4)
  .batch/
    inputs/<custom_id>.jsonl
    results/<batch_id>.jsonl
    <custom_id>.ticket.json     # {batch_id, custom_id, status, model, submitted_at, ...}
    <custom_id>.status.json     # mirror of batch status
    jobs.ndjson                 # append-only ledger
  probe-minutes.md              # probe artifacts (read-only)
  probe-decisions.json
```

This *in‑place* layout remains tolerant to user edits between runs.

### 5.4 Optional SQLite per level

**File**: `<level-dir>/.photo-select/state.db`

```sql
CREATE TABLE jobs(
  id TEXT PRIMARY KEY,            -- custom_id
  batch_id TEXT NOT NULL,
  level_dir TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,           -- validating|in_progress|finalizing|completed|failed|expired|cancelled
  input_path TEXT NOT NULL,
  output_path TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  image_bytes INTEGER DEFAULT 0,
  est_cost_cents INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);
CREATE INDEX jobs_status ON jobs(status);
```

SQLite is *optional* in MVP; JSON tickets suffice. When enabled (`PHOTO_SELECT_BATCH_SQLITE=1`), `photo-select status` can print per‑level scoreboards and projections.

### 5.5 Probe mode

`photo-select probe --n <int>` runs a *realtime* session against a small subset at the current level, writing `probe-minutes.md` and `probe-decisions.json` only. This supports the reflective “chef’s tasting” without disturbing the pipeline.

### 5.6 Image inputs & size discipline

We pass **proxy images** (long edge ≈1600px, JPEG Q≈85) to keep request bodies within limits and token accounting predictable. If a session exceeds body limits, split it into sequential parts `-part1`, `-part2` and merge decisions prior to moves. (Batch supports images; verify on model card; capability can vary by release.) ([OpenAI Help Center][2])

---

## 6. CLI & UX

New provider & subcommands:

```bash
# Enqueue work at this level using Batch
photo-select --provider openai-batch \
  --model gpt-5 \
  --reasoning-effort medium \
  --curators "Ingeborg Gerdes, Deborah Treisman, M.M. Bakhtin, Jonas Mekas" \
  --workers 10 \
  --context /path/to/context.txt

# Watch and apply results as jobs complete
photo-select batch watch --dir /path/to/story

# List, cancel, switch gears
photo-select batch ls
photo-select batch cancel <batch_id>
photo-select gear openai         # switch to realtime for new sessions
photo-select gear openai-batch   # back to batch

# Taste the soup (no moves)
photo-select probe --n 3
```

**Flags (new):**

| Flag                       |     Default | Purpose                                           |
| -------------------------- | ----------: | ------------------------------------------------- |
| `--provider openai-batch`  |             | Use the Batch provider                            |
| `--batch-check-interval`   |       `60s` | Poll cadence in `watch`                           |
| `--batch-max-in-flight`    | `--workers` | Upper bound on queued jobs per level              |
| `--model-fallback <model>` |             | Use if chosen model/endpoint isn’t batch‑eligible |
| `--batch-keep-jsonl`       |     `false` | Keep input JSONL sidecar for debugging            |

**Environment:**

* `OPENAI_API_KEY`, `OPENAI_ORG_ID` (as today)
* `PHOTO_SELECT_BATCH_CHECK_INTERVAL_MS`, `PHOTO_SELECT_BATCH_MAX_IN_FLIGHT`
* `PHOTO_SELECT_BATCH_SQLITE=1` to enable the DB
* Optional `PHOTO_SELECT_BUDGET_USD` to guardrails enqueueing

---

## 7. Observability & cost

* Append to `jobs.ndjson` on *every* state change.
* Maintain estimated spend: `(input_tokens × unit_in + output_tokens × unit_out) × batch_discount`. Batch pricing is ~**50%** off synchronous. ([OpenAI][1])
* `photo-select status` prints per‑level scoreboard:

```
level-03  queued:1 running:0 completed:1 failed:0 expired:0  est_cost:$0.42  model:gpt-5  provider:openai-batch
```

---

## 8. Failure, retry, expiry

Batch states to handle: **validating → in_progress → finalizing → completed | failed | expired | canceling → canceled**. Expired jobs may yield partial results; apply what’s valid and re‑enqueue leftovers. (OpenAI lists these states and 24h semantics; batch has separate limits, no streaming, images supported.) ([OpenAI Help Center][2])

**Retries**: exponential backoff with jitter; cap attempts; write `failed-reply-*.json` on parse/validation errors; mark files `NEEDS_REVIEW` (no moves).

**Idempotency**: `custom_id` is a content hash of (system prompt + context text + image list + curator roster + knobs). Resubmitting the same session updates status rather than duplicating work.

---

## 9. Security & privacy

* Batch endpoint **does not** support zero‑data‑retention; document this clearly. ([OpenAI Help Center][2])
* Avoid embedding PII in `custom_id`; use path hashes.
* Make probe output opt‑in for sharing; minutes still live alongside decisions in the level dir to keep practice legible.

---

## 10. Back‑compat

* Existing providers (`openai`, `ollama`) are untouched; the new provider is opt‑in via `--provider openai-batch`.
* Artifact names and file moves remain identical.
* Orchestrator recursion is unchanged; only submission/collection plumbing differs.

---

## 11. Implementation plan (MVP)

1. **Provider module**

   * `src/providers/openai-batch.js`: implements `submit/collect/cancel` using the OpenAI SDK `files` + `batches` APIs and writes per‑session tickets/artifacts.
   * Capability check: try `/v1/responses` for selected model, fall back to `/v1/chat/completions` if unsupported.

2. **Orchestrator glue**

   * If provider resolves a handle with `{deferred:true}`, orchestrator proceeds without blocking; `batch watch` (or a background loop when the CLI is attached) later calls `collect()` to apply results.

3. **CLI**

   * Add `photo-select batch ls|watch|cancel`, `photo-select gear <provider>`, and `probe`.

4. **Validation**

   * Reuse the strict JSON schema you already send to GPT‑5; validate assistant JSON again with AJV (V8+) before moves.

5. **Tests**

   * Unit: JSONL generation preserves our schema and knobs.
   * Integration: fixture a “completed” batch result; ensure minutes + moves match realtime oracle.
   * Concurrency: reservations prevent overlap across multiple in‑flight jobs.
   * Failure: `failed|expired|canceled` paths mark state and do not move files.

6. **Docs**

   * README section: Batch mode (cost, 24h window, statuses, images, no streaming, data-retention note, separate limits). ([OpenAI Help Center][2])

---

## 12. Alternatives considered

* **Many sessions per batch job**: better throughput per job but complicates partial failures and size limits. Rejected for MVP: the “one session = one job” mapping aligns with current mental model and simplifies retries.
* **Global SQLite**: we prefer *per‑level* placement so human inspection mirrors the process, and runs tolerate user‑driven file moves.

---

## 13. Open questions

1. **Watch mode UX**: Should the CLI optionally stay attached and stream a status table until the current level settles?
2. **Budget guardrails**: Stop enqueuing when `est_cost > PHOTO_SELECT_BUDGET_USD`? (Default off.)
3. **Model cadence checks**: Should we auto‑probe model cards on startup to pre‑warn if `/v1/responses` isn’t batch‑eligible for a chosen model?

---

## 14. Appendix

### 14.1 Example JSONL (Batch → Responses)

```json
{"custom_id":"ps-level003-0007","method":"POST","url":"/v1/responses",
 "body":{
   "model":"gpt-5",
   "reasoning":{"effort":"medium"},
   "text":{
     "verbosity":"low",
     "format":{"type":"json_schema","name":"PhotoSelectPanelV1","strict":true,"schema":{ /* elided */ }}
   },
   "input":[
     {"role":"user","content":[
       {"type":"input_text","text":"Context (collapsed) ..."},
       {"type":"input_text","text":"{\"filename\":\"DSCF0001.jpg\",\"people\":[\"Alice\",\"Bob\"]}"},
       {"type":"input_image","image_url":{"url":"data:image/jpeg;base64,..."}} 
     ]}
   ]
 }}
```

OpenAI Batch cookbook shows JSONL with `custom_id`, `method`, `url`, `body`, and demonstrates image workflows and that batch completes within 24h at lower price/higher rate limits. ([OpenAI Cookbook][3])

### 14.2 Batch states (for status files)

`validating | in_progress | finalizing | completed | failed | expired | canceling | canceled` with a 24‑hour target; no streaming; images supported; separate limits. ([OpenAI Help Center][2])

---

## 15. Why this fits the practice

The *feeling* remains intact: curators in dialogue; minutes that read like a room; decisions applied level‑by‑level; and artifacts exactly where you’re looking. Batch becomes a gentler gear—cheaper, separate‑quota—and your *tasting spoon* stays handy via `probe`. You can switch gears mid‑run without breaking rhythm, and you keep editorial fidelity while gaining operational headroom.
