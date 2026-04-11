### RFC 0009 — OpenAI Batch Provider (V2)

**Status:** Proposed
**Owner:** Jamie Burkart
**Reviewers:** Matteo Collina, Simon Willison, Evgeny Poberezkin, James M. Snell, Logan Kilpatrick, Yehuda Katz, Erik Bernhardsson, Deborah Treisman
**Created:** 2025‑10‑18
**Target Version:** v0.3.x

---

### 0. Summary

Add a new provider, **`openai-batch`**, that executes each *curatorial session* as a single **OpenAI Batch API** request to the **Responses API**. The batch job is submitted with a JSONL input containing exactly **one** request (one session), then polled until an **output file** is available; minutes and decisions are written in place, and files are moved the same as in realtime runs.

This keeps our invariants intact:

* **One session ⇄ one call** (here: one JSONL line, one batch job). ([OpenAI Platform][1])
* **Structured outputs** via Responses **JSON schema** with `strict: true`, identical to our realtime GPT‑5 path. ([OpenAI Platform][3])
* **On‑disk choreography** unchanged: minutes and decisions land beside the photos; `_keep/_aside` moves apply only after valid decisions. 

Batch is asynchronous (no streaming), targets completion within a time window (e.g., **`"24h"`), and typically offers **lower per‑token pricing** than synchronous requests. ([OpenAI Platform][1])

---

### 1. Motivation

Jamie’s practice works in **stories**: 2–10k images + a rich context file (site copy, emails, calendar, voice memos) → curatorial round‑tables that produce minutes and decisions, recursing level‑by‑level until the set settles. Runs can span days. The Batch API matches this cadence and reduces cost, provided we can: (a) **taste** progress without committing moves, (b) **switch gears** between realtime and batch, and (c) **resume** safely after interruptions. 

---

### 2. Non‑Goals

* Changing selection logic, persona roster, or artifact formats.
* Streaming partial batch results (Batch does not stream). ([OpenAI Platform][1])
* Guaranteeing any particular model is batch‑eligible; we’ll **detect and fall back**. (Model cards and eligibility can change.) ([OpenAI Platform][1])

---

### 3. Terminology

* **Session:** One curatorial round‑table over a subset of photos at a single recursion level.
* **Gear:** Provider mode: `"realtime"` or `"openai-batch"`.
* **Probe/Taste:** Realtime, *read‑only* run that produces **probe‑minutes** and **probe‑decisions** but **does not move files**.
* **Level:** A directory under review; recursion continues into `_keep` when a level settles. 

---

### 4. Current state (abridged)

* Realtime provider (OpenAI) already supports GPT‑5 via the **Responses** API with strict JSON schema outputs.
* The orchestrator writes minutes and decisions, moves files into `_keep/_aside`, then recurses.
* People metadata (“Jamie’s notes”) flows from **photo-filter** and is included per image. 

---

### 5. Goals

1. **Drop‑in parity:** Given identical inputs, batch and realtime produce the **same artifact shapes** and **file moves**.
2. **One session = one JSONL line/job:** Bound request size and keep mapping simple. ([OpenAI Platform][1])
3. **Hot gear switch:** Change provider mid‑run without restart; in‑flight jobs finish on their original gear.
4. **Tasting & status:** Probe anytime; show a status dashboard with costs, queue depth, and per‑level progress.
5. **Per‑level durability:** A small SQLite sidecar (optional but on by default) in the level directory for resume and inspection.

---

### 6. High‑level design

#### 6.1 Provider interface

```ts
// src/providers/types.ts
export interface CuratorialProvider {
  name: string;                   // 'openai' | 'openai-batch' | ...
  supportsAsync: boolean;         // batch provider: true
  submit(session: SessionInput): Promise<SessionHandle>; // enqueue or run
  collect(handle: SessionHandle): Promise<SessionResult>; // resolve into minutes+decisions
  cancel?(handle: SessionHandle): Promise<void>;          // best-effort
}
```

```ts
// src/providers/openai-batch.ts (new)
export default class OpenAIBatchProvider implements CuratorialProvider { /* … */ }
```

The orchestrator remains the consumer; it only adds an **async two‑phase** path when `supportsAsync`.

#### 6.2 Two‑phase orchestrator

* **SUBMIT:** Partition unclassified images into subsets (≤ `BATCH_SIZE`, default 10). Build the **same Responses payload** we use in realtime (instructions, `input[]` items, per‑image people notes). Serialize a **single‑line JSONL** with:

  ```json
  {
    "custom_id": "ps:<abs-level-path>|<sha256-of-inputs>",
    "method": "POST",
    "url": "/v1/responses",
    "body": {
      "model": "gpt-5",
      "reasoning": { "effort": "medium" },
      "text": {
        "format": { "type": "json_schema", "name": "PhotoSelectPanelV1", "strict": true }
      },
      "max_output_tokens": 32000,
      "input": [ /* multimodal items including input_image.image_url and input_text */ ]
    }
  }
  ```

  (Shape per **Batch** JSONL; body mirrors our **Responses** call and multimodal items, including `input_image.image_url` for vision.) ([OpenAI Platform][1])

  Upload JSONL with **Files API** `purpose:"batch"`, create a **Batch** with `endpoint:"/v1/responses"` and `completion_window:"24h"`. Persist `{custom_id,batch_id,input_file_id}`. ([OpenAI Platform][1])

* **APPLY (watcher):** Poll `batches.retrieve(batch_id)` until terminal. On `completed`, download the `output_file_id`, parse the line matching `custom_id`, validate JSON against `PhotoSelectPanelV1`, write `minutes-<uuid>.json`, then **apply file moves** atomically and mark the session `applied`. If `error_file_id` exists, store it for debugging and optionally re‑enqueue. ([OpenAI Platform][1])

Optional: subscribe a **webhook** to get notified when a batch completes (future enhancement beyond MVP). ([OpenAI Platform][4])

#### 6.3 Filesystem artifacts (unchanged placement)

At each recursion level `<level_dir>/`:

```
minutes-<uuid>.json            # final minutes (unchanged)
decisions.json                 # final decisions (unchanged, if you keep this file)
_keep/  _aside/                # post-decision moves (unchanged)

.photo-select/                 # new or extended
  sqlite.db                    # per-level state (jobs, reservations, usage)
  jobs.ndjson                  # append-only ledger (human tail)
  inputs/<custom_id>.jsonl     # exact JSONL sent to Batch
  tickets/<custom_id>.json     # {batch_id, custom_id, status, model, submitted_at, ...}
  status/<custom_id>.json      # latest batch state snapshot
  results/<batch_id>.jsonl     # raw results as delivered by OpenAI
  probe-minutes.md             # from taste runs (never moves files)
  probe-decisions.json         # from taste runs (never moves files)
```

This keeps the story directory the “living room” where you read minutes and watch decisions arrive. 

---

### 7. Data model (SQLite)

**File:** `<level_dir>/.photo-select/sqlite.db`

```sql
CREATE TABLE jobs (
  custom_id TEXT PRIMARY KEY,
  level_path TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,     -- queued|in_progress|finalizing|completed|failed|expired|canceled|applied
  batch_id TEXT,
  input_file_id TEXT,
  output_file_id TEXT,
  error_file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE reservations (
  file TEXT PRIMARY KEY,
  custom_id TEXT NOT NULL REFERENCES jobs(custom_id),
  status TEXT NOT NULL        -- reserved|applied|released
);

CREATE TABLE usage (
  custom_id TEXT PRIMARY KEY REFERENCES jobs(custom_id),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  image_bytes INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0
);

CREATE INDEX idx_jobs_status ON jobs(status);
```

**Idempotency:** `custom_id = sha256(system + context + images + curators + knobs + level_path)`. Resubmitting with the same inputs converges to one application.

---

### 8. CLI & UX

* **Run (enqueue):**

  ```bash
  photo-select --provider openai-batch --model gpt-5     --reasoning-effort medium     --curators "Ingeborg Gerdes, Deborah Treisman, M.M. Bakhtin, Jonas Mekas"     --workers 10     --context /path/to/context.txt
  ```

* **Watch (apply results as they complete):**

  ```bash
  photo-select batch watch --dir /path/to/story
  ```

* **Status & control:**

  ```bash
  photo-select batch ls
  photo-select batch cancel <batch_id>
  photo-select probe --n 3             # taste-only, never moves files
  photo-select gear batch|realtime     # hot switch for *new* sessions
  ```

* **Flags (new):**

| Flag                       |     Default | Purpose                                     |
| -------------------------- | ----------: | ------------------------------------------- |
| `--provider openai-batch`  |           — | Use the Batch transport                     |
| `--batch-window`           |       `24h` | Batch completion window (string)            |
| `--batch-check-interval`   |       `60s` | Polling cadence in watch mode               |
| `--batch-max-in-flight`    | `--workers` | Cap jobs per level                          |
| `--model-fallback <model>` |           — | Fallback if chosen model not batch‑eligible |

* **Env:**

  * `OPENAI_API_KEY` (required), `OPENAI_ORG_ID` (optional)
  * `PHOTO_SELECT_PROVIDER` (default gear)
  * `PHOTO_SELECT_BATCH_CHECK_INTERVAL_MS`, `PHOTO_SELECT_BATCH_MAX_IN_FLIGHT`
  * `PHOTO_SELECT_MAX_OLD_SPACE_MB` (unchanged)

---

### 9. OpenAI integration details

* **Creation flow:** `files.create(purpose:"batch")` → `batches.create({endpoint:"/v1/responses", input_file_id, completion_window:"24h"})` → poll `batches.retrieve(id)` → on `completed`, download `output_file_id` (and inspect `error_file_id` if present). Each JSONL line must include a unique **`custom_id`** so you can match results. ([OpenAI Platform][1])

* **Request format:** JSONL object with `method:"POST"`, `url:"/v1/responses"`, and a `body` that mirrors our realtime call (including **structured outputs** and **vision** inputs via `input_image.image_url`). ([OpenAI Platform][1])

* **Throughput & quotas:** Batch uses a separate queue; **tokens from pending batch jobs count against your batch queue limit** until completion—budget your in‑flight jobs accordingly. ([OpenAI Platform][2])

* **Lifecycle & events:** Status progresses through validation/in‑progress/finalizing/terminal states; optional **webhooks** can notify on completion (future enhancement). ([OpenAI Platform][4])

---

### 10. Image inputs & size discipline

* Use downscaled **proxy images** (e.g., long edge ≤ 1600px, JPEG Q≈85) to keep each session well under request limits and control cost.
* If a session would exceed limits, split deterministically into `-part1`, `-part2` within the **same level**; merge decisions **before** moves.

Vision is supported with Responses via `input_image.image_url` (URLs or data URLs). ([OpenAI Platform][5])

---

### 11. Observability & “taste the soup”

* `photo-select status` prints per‑level scoreboard:

  ```
  level-03  queued:1 running:0 completed:1 failed:0 expired:0  est_cost:$0.42  model:gpt-5
  ```
* Append a ledger line to `<level_dir>/.photo-select/jobs.ndjson` when a job changes state.
* Optional: `datasette <level_dir>/.photo-select/sqlite.db` for deep inspection (out of scope to bundle).
* **Probe** writes `probe-minutes.md` / `probe-decisions.json` and never moves files.

---

### 12. Failure, retries, expiry

* **States:** `queued → in_progress → finalizing → completed | failed | expired | canceled` (provider) then `applied` (ours). ([OpenAI Platform][1])
* **Retries:** Exponential backoff + jitter; N attempts (default 2) for transient failures.
* **Expired:** Re‑enqueue with the same `custom_id`; keep lineage by linking new `batch_id`.
* **Invalid JSON:** One “repair” attempt; otherwise write `NEEDS_REVIEW` marker and continue.
* **Cancellation:** Best‑effort; release `reservations` and re‑queue leftovers if needed.

---

### 13. Privacy & compliance

* Context and proxy images are sent to OpenAI; adhere to platform data controls and your project’s privacy policy.
* Avoid embedding PII in `custom_id`; hash paths; keep identifying data locally.
* Document that batch is **asynchronous** and **non-streaming**; results are retrieved via output files. ([OpenAI Platform][1])

---

### 14. Backwards compatibility

* Existing providers (`openai`, `ollama`) unchanged.
* New provider is **opt-in** via `--provider openai-batch`.
* Artifact locations and recursion semantics unchanged, so users can safely interrupt / resume and **switch gears** between sessions. 

---

### 15. Implementation plan (MVP)

**Code**

* `src/providers/openai-batch.ts` — implement `submit/collect/cancel`, JSONL serializer, file upload, batch create, poll, result parsing.
* `src/providers/index.ts` — register `'openai-batch'`.
* `src/orchestrator.ts` — introduce two-phase path when `supportsAsync=true`; reuse existing parse→move→recurse logic.
* `src/db/sqlite.ts` — helper for per-level DB (jobs/reservations/usage).
* `src/cli/batch.ts` — `ls`, `watch`, `cancel`.

**Tests**

* Unit: JSONL generation equals synchronous **Responses** body; schema validation path identical.
* Integration: stub batches client; assert artifacts layout and that minutes/decisions are identical to realtime oracle for a fixed fixture.
* Concurrency: reservations prevent duplicate moves across mixed realtime/batch runs.

**Docs**

* README: new provider, “taste the soup,” cost/throughput notes, and model eligibility notes.

---

### 16. Risks & mitigations

* **Model eligibility drift:** Detect at startup; log and fall back. ([OpenAI Platform][1])
* **Request size blow-ups:** Enforce proxy images, hard cap images per session, and split deterministically.
* **Queue starvation / spend spikes:** Cap in-flight jobs; show projected spend; expose `--batch-max-in-flight`. ([OpenAI Platform][2])
* **Narrative degradation:** Keep a small “voice QA” (optional) and rely on probes; never move files on probe. 

---

### 17. Open questions

1. Should **watch** block by default (like `tail -f`) or return immediately with a suggested `--follow`?
2. Do we support multi-request batches for tiny stories (several sessions per JSONL) to reduce per-job overhead? (Leaning **no** for MVP to preserve “one session = one call”.)
3. Add webhook support now or later? (Leaning **later**; polling suffices.) ([OpenAI Platform][4])

---

### 18. Appendix A — Minimal Node sketch

```ts
// provider/openai-batch.ts (sketch)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';

export default class OpenAIBatchProvider {
  name = 'openai-batch';
  supportsAsync = true;
  constructor(private cfg: Cfg, private db: DB, private openai: OpenAI) {}

  private idFor(session: SessionInput) {
    const h = createHash('sha256');
    h.update(JSON.stringify({
      level: session.levelPath,
      model: this.cfg.model,
      curators: session.curators,
      contextHash: session.contextHash,
      images: session.images.map(i => i.hash),
      knobs: { verbosity: session.verbosity, effort: session.reasoningEffort }
    }));
    return `ps:${session.levelPath}|${h.digest('hex').slice(0,32)}`;
  }

  async submit(session: SessionInput): Promise<SessionHandle> {
    const custom_id = this.idFor(session);
    await this.db.upsertJob({ custom_id, status: 'queued', level_path: session.levelPath, model: this.cfg.model });

    const line = buildJsonlLineForResponses({ custom_id, session, model: this.cfg.model }); // mirrors realtime
    const jsonlPath = path.join(session.levelPath, '.photo-select', 'inputs', `${custom_id}.jsonl`);
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.writeFileSync(jsonlPath, `${JSON.stringify(line)}
`);

    const file = await this.openai.files.create({ file: fs.createReadStream(jsonlPath), purpose: 'batch' });
    const batch = await this.openai.batches.create({
      input_file_id: file.id, endpoint: '/v1/responses', completion_window: this.cfg.batchWindow ?? '24h'
    });

    await this.db.updateJob(custom_id, { status: 'in_progress', batch_id: batch.id, input_file_id: file.id });
    return { provider: 'openai-batch', custom_id, batch_id: batch.id };
  }

  async collect(h: SessionHandle): Promise<SessionResult> {
    while (true) {
      const b = await this.openai.batches.retrieve(h.batch_id);
      if (b.status === 'completed') {
        const stream = await this.openai.files.content(b.output_file_id!);
        const raw = await stream.text();
        await this.db.updateJob(h.custom_id, { status: 'completed', output_file_id: b.output_file_id });
        const { minutes, decisions } = parseBatchOutput(raw, h.custom_id); // reuses realtime parser + schema
        return { minutes, decisions };
      }
      if (b.status === 'failed' || b.status === 'expired' || b.status === 'canceled') {
        await this.db.updateJob(h.custom_id, { status: b.status, error_file_id: b.error_file_id ?? null });
        throw new Error(`batch ${b.status}`);
      }
      await sleep(this.cfg.pollIntervalMs ?? 60000);
    }
  }

  async cancel(h: SessionHandle) {
    // Best-effort; not guaranteed if already finalizing
    await this.openai.batches.cancel(h.batch_id).catch(() => {});
    await this.db.updateJob(h.custom_id, { status: 'canceled' });
  }
}
```

(Shapes and fields align with OpenAI’s **Batch** and **Responses** references; use your existing structured-output schema and multimodal builder.) ([OpenAI Platform][1])

---

### 19. Why this fits the practice

It keeps the curators’ dialog audible and legible, places state where the art lives (in the level directory), and lets you **change gears** between realtime reflection and batch thrift. Minutes still read like a room; the story still settles level‑by‑level; you still taste as you go. 
