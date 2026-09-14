# Integrating completed Photo Select runs, level by level

Procedure version: 2026-09-14, with inclusive source-count bounds.

The purpose is to prepare a cumulative photographic palette for downstream
curators. Each integration brings together selected photographs from the same
relative depth in the original runs. It preserves useful differences between
their readings. It does not prescribe an animation, a sequence, a numerical
ranking, or the downstream team's final choices.

## 1. Establish the sequence and its sources

Create one dated integration parent outside the original run directories. Its
image directories are consecutive siblings: `01`, `02`, `03`, and so on.
Keep the original runs intact. Retain original filenames and image bytes.
Place manifests, receipts and reading notes beside the numbered directories,
so each numbered directory contains only its selected photographs.

Identify the two original completed runs and assign stable source IDs, such as
`A` and `B`. Record their roots, terminal processing levels and completion
evidence. Use the same runs throughout this sequence. The helper also accepts
more than two explicitly named runs; the same rules apply across all sources.

Use the saved `_level-NNN` input snapshots to recover each processing level.
The terminal all-keep pass repeats the deepest shortlist. Its parent's live
directory may be empty after photos were moved into `_keep`; that empty parent
is not the source inventory. Do not combine `_aside` subtrees to invent a level.

For integration number `k`, each source contributes:

```text
source_processing_level(k) = source_terminal_level - (k - 1)
```

Thus `01` draws from each terminal shortlist; `02` draws from the next less deep
snapshot of each run. Continue one processing level at a time. Different runs
may finish at different depths. Align their distance from the terminal level,
not their absolute processing numbers. If a source has no next valid level
before the game finishes, pause for a source-scope decision; do not mark the
game complete.

## 2. Freeze complete inventories and count the sources

For every source snapshot, record its source ID, directory, terminal level,
current level and complete direct-image inventory. For every image record the
original filename, byte length and SHA-256 of its contents. At `02` and later,
freeze the complete preceding integration inventory as well.

Count every direct regular image file with a supported extension: `jpg`,
`jpeg`, `png`, `tif`, `tiff`, `webp`, `heic`, `avif`, `gif` or `dng`, ignoring
extension case. Do not count metadata, receipts, subdirectories, or images
inside subdirectories. This is a file count, not a perceptual-deduplication
count. Distinct filenames remain distinct candidates even if they look similar.

Count each source separately, before combining it with the others. A filename
present in both sources contributes once to each source's count, but becomes
one output candidate only if its bytes and size agree. Preserve both source
witnesses. Reject conflicting bytes, repeated entries within one inventory,
symlinks, unsafe filenames, and case/Unicode filename collisions.

## 3. Apply all selection rules together

Let `S_A(k)` and `S_B(k)` be the verified source sets for level `k`. Let `I(k)`
be the integration and let `I(0)` be empty. Image identity here requires the
original filename and identical bytes.

```text
candidate_pool(k) = union of the source sets at level k
minimum(k)        = smallest source count at level k
maximum(k)        = largest source count at level k

I(k-1) ⊆ I(k) ⊆ candidate_pool(k)
minimum(k) ≤ count(I(k)) ≤ maximum(k)
```

The bounds are inclusive and apply to the **entire output**, including inherited
photos. They do not apply only to additions. The upper bound is the largest
individual source count, not the size of the union or a cumulative archive.
The count rule applies to `01` too, with no inherited photos.

At `02` and later, every photograph in the preceding integration must remain
with the same filename and bytes. The practical allowed range is:

```text
effective_minimum = max(minimum, preceding_integration_count)
allowed_total     = effective_minimum through maximum, inclusive
allowed_additions = max(0, minimum - preceding_integration_count)
                    through maximum - preceding_integration_count
```

Example: source counts of 16 and 12 permit 12–16 photographs. With 11 inherited
photos, select 1–5 additions. With 14 inherited, select 0–2 additions. With 18
inherited, there is no feasible selection under both rules.

An equal-size superset is valid when it meets the bounds. Being selected in both
runs does not automatically make a photo mandatory; inheritance from the
preceding integration does. There is no required quota from either run and no
requirement to reach the maximum. Every output photo must come from the current
source pool, including all inherited photos.

If the rules conflict, pause before copying and report the source counts,
inherited count and specific conflict. Preserve the existing directories.
Do not silently drop inherited photos, inflate counts, substitute a source,
skip a level, or relax the bound. An oversized earlier selection requires a
reviewed revision starting at the first affected level, or an explicitly
approved rule change. A revised sequence should be created alongside the
originals, retaining the earlier version as a historical record.

## 4. Make a close reading of the full candidate pool

Inspect every candidate at useful resolution, including inherited photographs
and alternatives. Read the relevant saved curatorial minutes and available
context. Keep visible evidence, recorded source claims and present
interpretation distinct. Metadata can supply identification context; appearance
alone is not a basis for inventing an identity.

For each photograph, describe the specific contribution it might make:
framing, gesture, gaze, light, focus, relation between bodies, foreground and
background, speaking and listening, institutional setting, historical echoes,
or ambiguities and tensions. Compare near alternatives directly. An addition
should contribute something that can be explained; an aside decision should
explain the limitation or overlap without claiming the image has no value.

Review the palette as a set: what becomes more legible, what remains uncertain,
and which different readings remain available? Preserve distinct viewpoints
where the permitted size allows them. Do not impose a storyline, animation
order, representational quota, or invented model preference score. Clearly
label any imagined expert discussion as fictionalized analytical lenses.

Record exactly one disposition and a nonempty reason for every unique candidate:

- `inherit`: every photo in the preceding integration, without substitution;
- `add`: a newly selected photo that expands the palette within the size limit;
- `aside`: a source alternative not copied at this integration level.

For `01`, use only `add` and `aside`. A prior aside can become an addition at a
later level if it remains in that level's source pool and room is available.
The selection remains an editable curatorial judgment; passing file checks
does not establish its aesthetic quality or authorize publication.

## 5. Write the private configuration and preflight it

Save `NN.selection.json` beside the proposed `NN` directory. Its fields are:

- `step`: the integer integration number, beginning with 1;
- `sources`: the full source records and frozen inventories described above;
- `decisions`: the complete candidate dispositions and reasons;
- `previous`: for step 2 onward, the preceding sibling's `directory` and complete
  `files` inventory. Omit this field at step 1.

Each file record has `filename`, lowercase hexadecimal `sha256`, and `bytes`.
Each source has `id`, `directory`, `terminalLevel`, `level`, and `files`.
Each decision has `filename`, `decision`, and `reason`.

The offline helper checks the configuration, complete inventories, hashes,
candidate coverage, inheritance and inclusive bounds before creating output.
Beginning at `02`, it requires a version-2 predecessor receipt, checks its
configuration and planned selection, and binds the inherited inventory and
consecutive source levels to the same source IDs and terminal levels. Source
locations are explicit trusted inputs: a matching folder name does not prove
an archive's history is authentic.

For a new sequence, build `01` through the same helper so its size rule and
provenance are recorded. Version-1 receipts predate the count rule; retain them
as historical evidence, not proof of compliance. The verifier rejects legacy
receipts instead of silently upgrading them or pruning their selections.

## 6. Copy, verify and record

Run from the Photo Select worktree, with the paths for the chosen level:

```sh
node scripts/integrate-selection.mjs build /private/path/02.selection.json /private/path/integration/02
node scripts/integrate-selection.mjs verify /private/path/integration/02
```

The helper uses exclusive copies into a new numbered sibling. Inherited images
are copied from the predecessor; additions are copied from their recorded
source. Existing outputs or receipts are never overwritten. Originals remain
in place. Filenames, image bytes and source modification times are preserved.

It checks the exact output image set and hashes, then checks the inputs again.
On success it writes `NN.integration.json` beside the image directory. This
version-2 receipt includes the frozen configuration and its hash, source
witnesses, per-source counts, inclusive bounds, effective minimum, selected
photos, inherited count and addition count.

The separate verifier is read-only. It rechecks the configuration, predecessor,
sources and exact output set; it exits nonzero on failure. Missing, changed or
unexpected photos and a missing receipt prevent a passing result. Sources must
remain available. This is an integrity check, not a cryptographic signature.

On ordinary build failure, only the output directory created by that invocation
is removed. Abrupt termination can leave a partial directory. Preserve and
inspect any partial output before rebuilding; an image folder without a valid
receipt is not a completed integration.

Save a private `NN-reading.md` with source mapping, counts, close readings,
dispositions, limitations, and verification results. Link photos by their
original filenames. A contact sheet or filename order is for navigation; it
does not constitute a preference ranking or animation order.

## 7. Continue, finish and evaluate

Stop after the first completed, verified integration containing **500 or more
photographs**. The source-count bounds and inheritance rule must still pass.
A planned or partially copied selection does not finish the game. The verifier
reports `gameStatus: complete` only after all file checks succeed; it reports
`continue` for a valid smaller level. The builder refuses another round after
a verified predecessor has reached 500. There is no requirement to truncate a
valid larger selection to exactly 500. For the plain-language physical-print
version, see [the game rules](integration-game-rules.md).

If a level passes both curatorial review and file verification and contains
fewer than 500 photographs, use that exact directory as the predecessor for
the next numbered sibling. Step back
once in each original run and repeat the complete procedure. Do not start a
new Photo Select model run merely to integrate completed results.

For changes to the helper, run:

```sh
npm run evals:integrated-selection
npm run hillclimb
git diff --check
```

The synthetic evaluations exercise real copies and the CLI, inclusive lower
and upper limits, impossible inheritance, overlap counts, first-level creation,
receipt continuity, filename conflicts, inventory drift and non-overwrite
behavior. Improve observed failures without weakening the invariants. Bind the
final focused evaluation receipt to the final candidate, update the existing
pull request, and report local checks and hosted CI separately.

Keep real photos, identifying source paths, configurations, close readings and
receipts outside the public repository. Public documentation and tests use
generic examples and synthetic file bytes. Automated passing checks establish
file integrity and rule compliance; they do not measure the curatorial merit
of the palette or the quality of a future animation.
