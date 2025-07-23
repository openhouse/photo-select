# Field Notes Workflow

The `--field-notes` flag enables a lightweight notebook that evolves alongside each directory level. When the flag is passed, a `field-notes.md` file is created next to every `_level-NNN` folder. After each batch of images is triaged the curators can update this file using a diff based workflow.

## How it works

1. On the first batch for a level the tool creates an empty `field-notes.md` with creation and update timestamps.
2. The current contents of the notebook are included in the prompt so the curators can propose additions or edits.
3. If the model returns a unified diff, it is applied to the notebook and the update timestamp is refreshed. A second pass may be triggered if the patch does not apply cleanly.
4. Bare filenames such as `DSCF0001.jpg` automatically link to images in the same directory.
5. When more than three inline images (`![]()`) appear in a single entry a warning is appended so the notes remain compact.
6. Include a brief description when linking or embedding images, e.g. `[cube overview](DSCF0001.jpg)` or `![cube overview](DSCF0001.jpg)`. The curatorial template now requires alt‑text for every reference.
7. If the target directory lacks a `.git` repository one is initialized automatically. Updates from the second pass are committed with the curator-provided message.

Disable the feature by omitting the flag. Each level keeps its own notebook so progress can be reviewed later.

## Historical background

An early Python prototype used diffs to update the notebook. The revised workflow sends **instructions** for how to edit the notes. A second LLM call then applies those steps and returns the complete file through `field_notes_md`. This logic lives in `FieldNotesWriter` and `orchestrator.js`.

## Migrating legacy notes

Notebooks created by the Python prototype lack headers and automatic links. Run `node scripts/migrate-notes.js <file>` to convert them to the current format. The script rewrites each file using `FieldNotesWriter`, preserving original text while adding timestamps and autolinks.
