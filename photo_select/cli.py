"""Command-line interface placeholder."""

import argparse
import json
import logging
from pathlib import Path
from typing import Callable

from .field_notes.writer import FieldNotesWriter, PatchResult
from .field_notes import md_store


def process_first_pass_result(
    writer: FieldNotesWriter,
    result_json: str,
    llm: Callable[[str], str] | None = None,
) -> PatchResult | None:
    """Handle first-pass LLM result and update notes when possible."""
    try:
        data = json.loads(result_json)
    except json.JSONDecodeError as exc:
        logging.warning("Bad JSON from first pass: %s", exc)
        return None

    diff = data.get("field_notes_diff")
    full = data.get("field_notes_md")

    if diff:
        if llm is not None:
            second_prompt = json.dumps(
                {
                    "FIELD_NOTES_PREVIEW": writer.md,
                    "FIELD_NOTES_DIFF": diff,
                }
            )
            try:
                second_result = llm(second_prompt)
                _ = json.loads(second_result).get("field_notes_md")
            except Exception as exc:  # noqa: BLE001
                logging.warning("Act II failed: %s", exc)
        return writer.maybe_apply_diff(diff)

    if full:
        new_text = writer.autolink_filenames(full, writer.path.parent)
        md_store.atomic_write(writer.path, new_text)
        writer.md = new_text
        lines_added = new_text.count("\n") - writer.md.count("\n")
        return PatchResult(True, lines_added)

    logging.warning("No field notes data found in response")
    return None


def parse_args(argv=None):
    parser = argparse.ArgumentParser(prog="photo-select")
    parser.add_argument("--field-notes", action="store_true", help="Enable living field-notes.md generation with curator diff workflow.")
    parser.add_argument("path", nargs="?", default="field-notes.md")
    return parser.parse_args(argv)


def main(argv=None, llm: Callable[[str], str] | None = None):
    args = parse_args(argv)
    if args.field_notes:
        path = Path(args.path)
        level = path.parent.name.split("-")[-1]
        writer = FieldNotesWriter(path, level=level)
        payload = json.dumps(writer.first_pass_payload())
        if llm is None:
            print(payload)
            return
        first_res = llm(payload)
        result = process_first_pass_result(writer, first_res, llm)
        if isinstance(result, PatchResult) and result.applied:
            print(
                f"\U0001F4D2  Updated field-notes (level-{writer.level}) — +{result.lines_added} lines"
            )


if __name__ == "__main__":
    main()
