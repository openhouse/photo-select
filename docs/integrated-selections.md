# Cumulative integration of completed selections

Use the offline integration helper to copy a reviewed selection from two or more
completed Photo Select runs into consecutive sibling directories (`01`, `02`,
`03`, ...). Every new directory preserves all photographs in its predecessor,
with identical filenames and bytes. It may add explicitly selected photographs.
An equal-size superset is valid. The helper never ranks or selects photographs,
moves originals, renders a prompt, or makes API requests.

```sh
node scripts/integrate-selection.mjs build /private/path/02.selection.json /private/path/integration/02
node scripts/integrate-selection.mjs verify /private/path/integration/02
npm run evals:integrated-selection
```

Keep real photos, source paths, configurations, readings and receipts outside
this public repository. Tests use synthetic file bytes, not actual photographs.

## Source levels

Use the saved `_level-NNN` input snapshots. The terminal all-keep pass repeats
the deepest shortlist; its parent's live directory may contain no images after
moves into `_keep`. For integration step `n`, each source level is its terminal
processing level minus `n - 1`. Thus runs ending at levels 5 and 3 contribute
`_level-004` and `_level-002` to integration `02`. Do not combine every `_aside`
subtree or infer the source inventory from an emptied parent directory.

## Private configuration

The JSON has `step` (integer >= 2), `previous`, `sources`, and `decisions`:

- `previous`: `directory` for the preceding sibling and a complete `files` array.
- `sources`: one object per run, each with a unique `id`, explicit snapshot
  `directory`, `terminalLevel`, current `level`, and complete `files` array.
- Every file record: original `filename`, lowercase SHA-256 `sha256`, and `bytes`.
- Every unique candidate receives exactly one decision with `filename`,
  `decision` (`inherit`, `add`, or `aside`), and a nonempty `reason`.

Every preceding photograph must exist unchanged in the source pool and be marked
`inherit`. Remaining photos receive `add` or `aside` after close reading. An
earlier alternate may be added at a broader level. Filenames shared across runs
are copied once only when their bytes agree; all source witnesses are retained.
Conflicting bytes and case/Unicode filename collisions are errors. Similar
photographs with different filenames are not automatically deduplicated.

The first directory (`01`) can be an existing reviewed selection. Starting with
`03`, the preceding integration receipt is required and binds the inherited
inventory, run IDs, terminal levels and consecutive source-level progression.
Source locations remain explicit trusted inputs: matching a folder name is not
proof that an archive's history is authentic.

## Integrity and evaluation

Frozen inventories include every direct image file with a supported extension
(`jpg`, `jpeg`, `png`, `tif`, `tiff`, `webp`, `heic`, `avif`, `gif`, `dng`).
Archive metadata is ignored; directories are not recursively scanned. Inputs
and all candidate hashes, including unselected alternatives, are checked before
copying and again afterward. Symlink roots/files, missing images, drift,
unrecorded images, incomplete decisions and existing outputs are rejected.
Copies retain source modification times. On ordinary build failure only the
directory created by that invocation is removed. An abrupt process termination
can leave a partial directory; verification requires the completed receipt.

`02` contains images only. `02.integration.json` lives beside it and preserves
configuration, decisions, source witnesses, inherited/addition counts and hashes.
The verifier rechecks the receipt, source pool, predecessor, and exact output
image set. It is read-only and exits nonzero on failure. It requires the source
directories to remain available; it is a local integrity check, not a signature.

The synthetic regressions exercise real filesystem copies and the actual CLI,
including omission, conflicts, drift, path safety, non-overwrite behavior,
tampering and successive integration. They run in the full hill-climb and the
focused knowledge gate. These checks establish cumulative copying and provenance;
they do not measure aesthetic quality or certify a final animation sequence.
