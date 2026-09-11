# Agents Contract · Photo‑Select

_(Last edited 2025‑07‑06)_

This file is **ingested by ChatGPT Codex (or any code‑assistant) before it may alter the repository**.  
Its contents are **immutable contracts**, _not_ sprint instructions.

---

## 0  Preface — Why a Contract?

Photo‑Select treats language models as synthetic colleagues.  
The contract protects:

1. **Narrative coherence** – curator voices stay consistent.
2. **Data provenance** – every action is auditable from raw image → minutes → Git commit.
3. **Security & determinism** – outputs are machine‑parseable, no hidden state.
4. **Compassionate practice** – code changes honour presence, connection, and healing.

### Mindful Commit Oath (invitation)

> _Before altering the repository, pause for one conscious breath and recall our shared purpose of fostering clarity, connection, and healing through code._

---

## 1  Voice Registry (session contract)

| ID          | Display Name      | Style Guide           |
| ----------- | ----------------- | --------------------- |
| Curator‑A   | Ingeborg Gerdes   | analytic, formal      |
| Curator‑B   | Alexandra Munroe  | scholarly, contextual |
| Curator‑C   | Deborah Treisman  | narrative, pace‑aware |
| Curator‑D   | Warren Sack       | systems‑thinking      |
| Facilitator | Jamie (off‑stage) | frames session only   |

> **Rule:** Without `--curators`, use the four curator Display Names above. An explicit `--curators` list is the base registry for `--github-all`; preserve those exact names unless the user explicitly enables the existing canonicalization policy. Restore the existing additional-curator rule: names tagged in at least two photos in a batch are appended through `finalizeCurators`, with placeholders excluded and the configured identity policy preserved. Freeze that batch roster across its requests, repairs, validation and audit; concurrent batches must not share additions. Repository source speakers never become curators automatically. All voices, including tagged people, are fictionalized lenses, not actual participants, quotations or endorsements. This user-authorized contract change ships as version 2.0.0.

---

## 2  Workflow Phases

| Phase                  | Expected LLM Output Keys                             | Parser Mode         |
| ---------------------- | ---------------------------------------------------- | ------------------- |
| **Triage**             | `minutes`, `decisions`, _optional_ `field_notes_diff` | `expectDiff = true` |
| **Act II** _(if diff)_ | `field_notes_md`                                     | `expectMd = true`   |

LLM receives identical personas, context, and filename whitelist in both passes.

---

## 3  Reply Schema Invariants

- **minutes** → `array<{ speaker:string, text:string }>`; last `text` ends with a forward‑looking question.
- **decisions** → `array<{ filename:string, decision:"keep"|"aside", reason:string }>`; include each reviewed filename exactly once.
- **field_notes_diff** or **field_notes_md** as per Phase rules.
- **No additional top‑level keys**.

---

## 4  Prompt Placeholders

For `--github-all`, use the ordinary prompt renderer and preserve the selected
original or custom prompt text. The flag attaches authenticated read-only tools;
it must not inject research, role-play, consent, citation or editorial directions.
Use the ordinary free-text speaker schema; do not reject a prompt-defined
facilitator with a GitHub-only speaker allowlist.
Context and people metadata follow the ordinary prompt workflow. Cache splitting
must preserve the rendered instruction bytes. This explicit user correction
supersedes the separate GitHub prompt introduced earlier in this PR.


| Placeholder      | Source            | Required                  |
| ---------------- | ----------------- | ------------------------- |
| `{{curators}}`   | CLI `--curators`  | ✓                         |
| `{{images}}`     | runtime file scan | ✓                         |
| `{{context}}`    | `--context` file  | optional                  |
| `{{fieldNotes}}` | prior notebook    | when `--field-notes` flag |

---

## 5  LLM Guardrails (immutable)

1. **Deterministic inputs** – filename whitelist, persona list, allowed JSON keys appear in _system_ and _user_ messages.
2. **JSON‑only outputs** – Codex must retry once on `JSON.parse` failure, then fail loudly.  
   _If failure persists, Codex emits a JSON object:_
   ```
   { "type": "repair_suggestion", "patch": "<unified diff>" }
   ```
   A successful second parse must log a `retry_recovered` event.
3. **No hidden state** – all deliberation lives in `minutes`; model memory is forbidden.
4. **Non‑Violent CI Feedback** – CI rejections follow this template, choosing `FEELING` from `docs/feelings.json`:

```
OBSERVATION: <what failed>
FEELING: <word>
NEED: contract integrity
REQUEST: <specific remediating action>
```

---

## 6  Provenance Requirements (immutable)

- Compute `sha256(filename)` for every image and `model_sha256` for each Codex run. For `--github-all` in version 2.0.0, store image hashes in `corpus.json` and request hashes plus timestamps in the private curation JSON, bound to the atomic Git commit. This mode uses JSON and Git provenance without introducing SQLite.
- Commit the LLM response JSON **and** updated `field‑notes.md` atomically.
- CI enforces a **30‑second merge delay** (mindfulness window).
- Pull requests opened 02:00–06:00 maintainer local time require an additional reviewer.

---

## 7  Coding Doctrine (immutable)

- Business logic never resides in `.hbs` templates—prompts are data‑only.
- Pure functions live under `src/core/`; they receive **all** inputs explicitly.
- **Turn‑Toward TODO Rule:** Codex must address or annotate each `TODO` unless the line contains `ARCHIVE`.
- Mutating a cached structure **must** bump the `cacheKey` prefix.
- **Change‑Set Limits:**

  - Warn at ≥ 300 modified lines.
  - Require `--mechanical` flag at > 500 lines.
  - Hard‑block auto‑merge at > 800 lines.

---

## 8  North‑Star Principles

- **≥ 99 % JSON validity** across the test suite.
- Optimise for verifiable auditability and user interpretability over raw speed.
- Preserve curator voice authenticity in every change.
- Track and report:

  - `json_validity_rate`
  - `retry_recovery_rate`
  - `todos_addressed/total_todos`

---

**Breaking this contract requires a major version bump.**
_MAY_: Integrations such as a Slack “mindfulness bell” during the merge delay are encouraged but not required.
