# Photo-Select – Core Concepts

**Batch** – A set of ≤ 10 images funnelled through a single prompt/response round.

**Curators (Agents)** – Named voices who appear in the “minutes” section.  
They function as *thinking styles* the LLM can adopt (e.g. technical, poetic).

**Facilitator** – Jamie’s voice; she does *not* appear in JSON minutes but frames the session.

**Minutes** – A diarised conversation (array of `{ speaker, text }`) capturing how consensus was reached.

**Decision Block** – Strict JSON `{ keep, aside }`, optionally enriched with `field_notes_diff`.

**Field Notes** – Markdown notebook (`field-notes.md`) evolving in two passes.  
First pass returns a diff; second pass resolves to the full document.

**Level Directory** – `_level-NNN/` snapshot preserving original files for provenance.

**Adapter** – Boundary module that converts between external systems (OpenAI, filesystem) and pure functions.

**Service** – Coordinator function (e.g. `triageDirectory`) that expresses application use-cases in terms of adapters & pure functions.
<<<<<<< HEAD

**Prompt Snapshot** – A `.prompt.txt` file stored in each level directory containing the exact text sent to the model for reproducibility.
=======
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
