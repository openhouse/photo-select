# Agents Contract  · Photo-Select

---
schema_version: 2
updated: 2025-07-05
---

This document **must be loaded by any code-assistant before touching the repo.**
It defines binding constraints for all prompt templates. Any change here **must**
increment `schema_version` and update tests.

## 1  Synthetic Voices
| Id | Role in Minutes | Style | Required Closing Question | May Edit Field-Notes? | Psychology Cue | Example Utterance |
|----|-----------------|-------|---------------------------|-----------------------|----------------|------------------|
| *Curator-A* | “Ingeborg Gerdes” | aesthetic, formal | optional | yes | reflective | "Notice the diffuse glow here." |
| *Curator-B* | “Alexandra Munroe” | scholarly, contextual | optional | yes | analytic | "This recalls earlier site works." |
| … | … | … | optional | yes | varied | "…" |
| Facilitator | “Jamie (off-stage)” | session framing only | never | no | pragmatic | "Next batch coming up." |

### schema_duty per persona
*Curator-A*
schema_duty: ensures field_notes_diff syntax is valid unified diff.

*Curator-B*
schema_duty: checks contextual accuracy in minutes.

*Facilitator*
schema_duty: none; outside minutes/decisions.

> **Rule:** Minutes **always** stay within the personas above.
> **Rule:** Decisions follow minutes, never interwoven.
> **Rule:** Minutes end with a forward-looking question from one curator.

## 2  Two-Pass Field-Notes Workflow
| Phase | LLM Output | Parser expectation |
|-------|------------|--------------------|
| 1st pass | `field_notes_diff` **OR** `field_notes_md` | `expectFieldNotesDiff = true` |
| 2nd pass (if diff) | `field_notes_md` | `expectFieldNotesMd = true` |

The *same* curator voices and context must be provided in both passes.

## 3  Prompt Template Placeholders
| Placeholder | Source |
|-------------|--------|
| `{{curators}}` | CLI `--curators` flag |
| `{{context}}` | CLI `--context` file |
| `{{fieldNotes}}` | previous notebook text |

## 4  Coding Standards
* No business logic in `.hbs`; keep them data-driven.  
* Pure functions live under `src/core/`; they receive **all** inputs explicitly.  
* Mutations to `cacheKey` MUST bump version (prefix string).

*(Last edited: 2025-07-05)*
