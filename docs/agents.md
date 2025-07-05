# Agents Contract · Photo‑Select

_(Last edited 2025‑07‑05)_

This file is **ingested by ChatGPT Codex (or any code‑assistant) before it may alter the repository**.  
Its contents are _immutable contracts_, **not** sprint instructions.

---

## 0  Preface — Why a Contract?

Photo‑Select treats language models as synthetic colleagues.  
The contract protects:

1. **Narrative coherence** – curator voices stay consistent.
2. **Data provenance** – every action is auditable from raw image → minutes → Git commit.
3. **Security & determinism** – outputs are machine‑parseable, no hidden state.

---

## 1  Voice Registry (immutable)

| ID          | Display Name      | Style Guide           |
| ----------- | ----------------- | --------------------- |
| Curator‑A   | Ingeborg Gerdes   | analytic, formal      |
| Curator‑B   | Alexandra Munroe  | scholarly, contextual |
| Curator‑C   | Deborah Treisman  | narrative, pace‑aware |
| Curator‑D   | Warren Sack       | systems‑thinking      |
| Facilitator | Jamie (off‑stage) | frames session only   |

> **Rule:** `minutes[*].speaker` **must** equal one of the _Display Name_ values—no aliases.

---

## 2  Workflow Phases

| Phase                  | Expected LLM Output Keys                             | Parser Mode         |
| ---------------------- | ---------------------------------------------------- | ------------------- |
| **Triage**             | `minutes`, `decision`, _optional_ `field_notes_diff` | `expectDiff = true` |
| **Act II** _(if diff)_ | `field_notes_md`                                     | `expectMd = true`   |

LLM receives identical personas, context, and filename whitelist in both passes.

---

## 3  Reply Schema Invariants

- **minutes** → `array<{ speaker:string, text:string }>`; last `text` ends with a forward‑looking question.
- **decision** → _object_ with optional keys **exactly** `"keep"` and `"aside"`; each maps `filename → rationale`.
- **field_notes_diff** or **field_notes_md** as per Phase rules.
- **No additional top‑level keys**.

---

## 4  Prompt Placeholders

| Placeholder      | Source            | Required                  |
| ---------------- | ----------------- | ------------------------- |
| `{{curators}}`   | CLI `--curators`  | ✓                         |
| `{{images}}`     | runtime file scan | ✓                         |
| `{{context}}`    | `--context` file  | optional                  |
| `{{fieldNotes}}` | prior notebook    | when `--field-notes` flag |

---

## 5  LLM Guardrails

1. **Deterministic inputs** – filename whitelist, persona list, allowed JSON keys repeated in _system_ and _user_ messages.
2. **JSON‑only outputs** – Codex must implement one automatic retry on `JSON.parse` failure, then fail loudly.
3. **No hidden state** – all deliberation lives in `minutes`; model memory is forbidden.

---

## 6  Provenance Requirements

- Compute `sha256(filename)` for every image; store alongside filename in SQLite.
- Commit the LLM response JSON **and** the updated `field‑notes.md` in a single atomic Git commit.

---

## 7  Coding Doctrine

- Business logic never resides in `.hbs` templates—prompts are data‑only.
- Pure functions live under `src/core/`; they receive **all** inputs explicitly.
- Mutating a cached structure **must** bump `cacheKey` prefix.

---

## 8  North‑Star Principles

- **≥ 99 % JSON validity** across the test suite.
- Optimise for verifiable auditability and user interpretability over raw speed.
- Preserve curator voice authenticity in every change.

---

Violating this contract constitutes a **breaking change** and requires a major version bump.
