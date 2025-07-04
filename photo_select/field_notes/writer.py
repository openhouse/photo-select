import logging
from dataclasses import dataclass
from datetime import datetime, timezone
import re
from pathlib import Path

from . import md_store, patch

_INSTR = "Add observations, open questions; propose git-style diff against the file above."


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class PatchResult:
    applied: bool
    lines_added: int = 0


class FieldNotesWriter:
    def __init__(self, path: Path, level: str | None = None):
        self.path = path
        self.level = level or ""
        self.md = md_store.get(path)
        if self.md == "":
            header = f"## Field Notes — Level {self.level}\n\n<!-- created: {_timestamp()} -->\n"
            self.md = header
            md_store.atomic_write(path, self.md)

    @staticmethod
    def autolink_filenames(md_text: str, image_dir: Path) -> str:
        """Link bare image filenames if they exist in ``image_dir``."""
        pattern = re.compile(r"\[(\w+\.(?:jpg|jpeg|png))\]", re.IGNORECASE)

        def repl(match: re.Match) -> str:
            name = match.group(1)
            if (image_dir / name).exists():
                return f"[{name}](./{name})"
            return match.group(0)

        new_text = pattern.sub(repl, md_text)
        if new_text.count("![") > 3:
            new_text += "\n\n> **Warning**: Inline image limit exceeded.\n"
        return new_text

    def first_pass_payload(self) -> dict:
        return {
            "FIELD_NOTES_PREVIEW": self.md,
            "FIELD_NOTES_INSTRUCTIONS": _INSTR,
            "FIELD_NOTES_LEVEL": self.level,
        }

    def maybe_apply_diff(self, diff: str) -> PatchResult:
        try:
            new_md = patch.apply(self.md, diff)
        except Exception as exc:
            logging.error("Field-notes patch failed: %s", exc)
            return PatchResult(False, 0)
        if new_md != self.md:
            stamp = f"\n<!-- updated: {_timestamp()} -->\n"
            new_md += stamp
            new_md = self.autolink_filenames(new_md, self.path.parent)
            md_store.atomic_write(self.path, new_md)
            lines_added = new_md.count("\n") - self.md.count("\n")
            self.md = new_md
            return PatchResult(True, lines_added)
        return PatchResult(False, 0)
