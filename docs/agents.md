# Agents Contract  · Photo-Select

This document **must be loaded by any code-assistant before touching the repo.**

## 1  Synthetic Voices
| Id | Role in Minutes | Style |
|----|-----------------|-------|
| *Curator-A* | “Ingeborg Gerdes” | aesthetic, formal |
| *Curator-B* | “Alexandra Munroe” | scholarly, contextual |
| … | … | … |
| Facilitator | “Jamie (off-stage)” | session framing only |

> **Rule:** Minutes **always** stay within the personas above.  
> **Rule:** Decisions follow minutes, never interwoven.

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
