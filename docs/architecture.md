# Photo-Select – Architecture at a Glance
├─ src/                     ← runtime code
│  ├─ cli/                  ← thin Cmd+Option wrappers (index.js only calls into here)
│  ├─ core/                 ← domain logic (triageDirectory, FieldNotesWriter, etc.)
│  ├─ adapters/             ← I/O edges: chatClient (OpenAI), imageSelector (fs), peopleApi
│  └─ templates/            ← compiled HBS strings (wired up at build time)
├─ prompts/                 ← raw *.hbs & *.txt prompt sources
├─ docs/                    ← human-readable guides
│  ├─ architecture.md       ← **you are here**
│  ├─ agents.md             ← prompt-engineering contract (see below)
│  └─ glossary.md           ← canonical vocabulary
└─ tests/                   ← Vitest; keep unit & integration separate

## Key patterns
1. **HBS as “configuration, not code.”**
Treat every Handlebars template exactly like a JSON schema: no business logic inside, just placeholders. The runtime helper (`renderTemplate`) already enforces this.
2. **Adapters > Services > Pure functions.**
   - Adapters know about network, fs, OpenAI.
   - Services orchestrate adapters (e.g. `triageDirectory`).
   - Pure functions (e.g. `parseReply`) have zero side-effects and live under `src/core/`.
3. **Prompt lifecycle.**

```
template.hbs  →  renderTemplate(data)  →  prompt string
prompt string + images  →  chatClient  →  JSON reply
JSON reply  →  pure parser  →  move/apply/write
```

4. **Second-pass prompts.**
Strip the addon rules before nesting the original prompt to avoid instruction collision (already noted; implementation pending).
5. **Cache keys are contracts.**
If you touch anything that changes the cacheKey hash inputs, bump the cache-version prefix so old replies don’t leak into new logic.
