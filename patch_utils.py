import difflib
import tempfile
import subprocess
from pathlib import Path


def generate(old: str, new: str) -> str:
    diff = difflib.unified_diff(
        old.splitlines(True),
        new.splitlines(True),
        fromfile="a/field-notes.md",
        tofile="b/field-notes.md",
    )
    return "".join(diff)


def apply(old: str, diff: str) -> str:
    with tempfile.TemporaryDirectory() as td:
        old_path = Path(td) / "field-notes.md"
        patch_path = Path(td) / "patch.diff"
        old_path.write_text(old)
        patch_path.write_text(diff)
        subprocess.run(["patch", old_path.name, patch_path.name], cwd=td, check=True)
        return old_path.read_text()

